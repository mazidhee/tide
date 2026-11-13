/**
 * The library of tested animation templates (shared/manim): each a Manim scene with a few
 * settings the tutor fills in for the learner's own example (their number, their matrix, their
 * function), and narration written from those settings, one line per beat. Claude picks one with
 * render_animation; Gemma writes an ```animation block naming one; either way Tide checks the
 * settings here before anything runs. Every template is smoke-rendered by the tests when Manim is
 * installed. Pure: the Python is text, built from the settings.
 */
import type { MathsArea } from './mathsMode'

export type ParamKind = 'int' | 'number' | 'formula' | 'formula2' | 'matrix' | 'vector' | 'enum' | 'words' | 'numbers'

export interface ParamSpec {
  kind: ParamKind
  default: unknown
  min?: number
  max?: number
  options?: string[]
  /** words: how many at most */
  maxItems?: number
  describe: string
}

export interface AnimTemplate {
  id: string
  title: string
  area: MathsArea
  /** Words in a topic that make this template fit */
  fits: RegExp
  /** The built-in explorable to hand over to after it ("watch, then break it") */
  explore?: string
  describe: string
  params: Record<string, ParamSpec>
  /** Why these settings can't make a good scene, beyond each one's range */
  check?(p: Params): string | null
  beats(p: Params): string[]
  /** The construct() body, indented 8 spaces; P holds the settings */
  body: string
}

export type Params = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const fmt = (x: number, places = 2) => (Number.isInteger(x) ? String(x) : x.toFixed(places).replace(/\.?0+$/, ''))

// ---------- Settings ----------

/** A formula in x (or x and y) as Python reads it: ^ to **, and 2x to 2*x */
export function pyFormula(f: string): string {
  return f
    .replace(/\^/g, '**')
    .replace(/(\d)\s*([a-z(])/gi, '$1*$2')
    .replace(/\)\s*([a-z0-9(])/gi, ')*$1')
    .replace(/\b([xy])\s*\(/g, '$1*(')
    .replace(/\b(x)\s*(y)\b/g, '$1*$2')
}

const FUNCS = /\b(sin|cos|tan|exp|ln|log|sqrt|abs|asin|acos|atan|sinh|cosh|tanh|pi|e)\b/g

/** Whether a formula uses only the variables, numbers, operators and functions the scenes allow */
export function formulaOk(f: string, vars: string): boolean {
  if (typeof f !== 'string' || !f.trim() || f.length > 80) return false
  const rest = f.replace(/\*\*/g, '^').replace(FUNCS, '').replace(new RegExp(`\\b[${vars}]\\b`, 'g'), '').replace(new RegExp(`(\\d)[${vars}]`, 'g'), '$1')
  return /^[\d\s.+\-*/^()]*$/.test(rest) && f.split('(').length === f.split(')').length
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)

/** One setting, read and checked: its value, or why it can't be used */
function readParam(name: string, s: ParamSpec, v: unknown): { ok: true; value: unknown } | { ok: false; why: string } {
  const bad = (why: string) => ({ ok: false as const, why: `${name}: ${why}` })
  const inRange = (x: number) => (s.min === undefined || x >= s.min) && (s.max === undefined || x <= s.max)
  const range = `${s.min ?? '…'} to ${s.max ?? '…'}`
  switch (s.kind) {
    case 'int':
    case 'number': {
      const x = num(v)
      if (x === null) return bad('a number')
      if (s.kind === 'int' && !Number.isInteger(x)) return bad('a whole number')
      return inRange(x) ? { ok: true, value: x } : bad(`between ${range}`)
    }
    case 'formula':
    case 'formula2': {
      const vars = s.kind === 'formula' ? 'x' : 'xy'
      if (typeof v !== 'string' || !formulaOk(v, vars)) return bad(`a formula in ${vars === 'x' ? 'x' : 'x and y'} (numbers, + - * / ^, sin cos tan exp ln sqrt abs, pi, e)`)
      return { ok: true, value: pyFormula(v.trim()) }
    }
    case 'matrix': {
      if (!Array.isArray(v) || v.length !== 2 || !v.every((r) => Array.isArray(r) && r.length === 2)) return bad('a 2×2 matrix, [[a, b], [c, d]]')
      const m = (v as unknown[][]).map((r) => r.map(num))
      if (m.flat().some((x) => x === null || !inRange(x))) return bad(`entries between ${range}`)
      return { ok: true, value: m }
    }
    case 'vector': {
      if (!Array.isArray(v) || v.length !== 2) return bad('a vector [x, y]')
      const m = v.map(num)
      if (m.some((x) => x === null || !inRange(x))) return bad(`entries between ${range}`)
      return { ok: true, value: m }
    }
    case 'numbers': {
      if (!Array.isArray(v) || !v.length || v.length > (s.maxItems ?? 8)) return bad(`a list of up to ${s.maxItems ?? 8} numbers`)
      const m = v.map(num)
      if (m.some((x) => x === null || !inRange(x))) return bad(`numbers between ${range}`)
      return { ok: true, value: m }
    }
    case 'enum':
      return typeof v === 'string' && s.options!.includes(v) ? { ok: true, value: v } : bad(`one of ${s.options!.join(', ')}`)
    case 'words': {
      if (!Array.isArray(v) || v.length < 2 || v.length > (s.maxItems ?? 6) || !v.every((w) => typeof w === 'string' && w.trim() && w.length <= 14)) return bad(`2 to ${s.maxItems ?? 6} short words`)
      return { ok: true, value: v.map((w) => String(w).trim()) }
    }
  }
}

// ---------- The templates ----------

const PLACE_NAMES = ['ones', 'tens', 'hundreds', 'thousands']

const placeValue: AnimTemplate = {
  id: 'place-value',
  title: 'Tally marks, place value and the invention of zero',
  area: 'algebra',
  fits: /\b(zero|place value|number systems?|numerals?|tally|babylon\w*|brahmagupta|hindu[- ]arabic|counting|positional|digits?|bases?|binary)\b/i,
  describe: 'A number counted as tally marks, regrouped into columns (ones, tens, hundreds), written Babylonian-style with a gap for the empty column, the gap collapsing so the number is misread, then zero filling the gap, and the place-value sum. number must contain a 0 (e.g. 205, 1040).',
  params: { number: { kind: 'int', default: 205, min: 10, max: 9999, describe: 'the number counted; it must have a 0 digit' } },
  check: (p) => (/0/.test(String(p.number)) ? null : 'number: it needs a 0 digit (e.g. 205), so there is an empty column to show'),
  beats(p) {
    const s = String(p.number)
    const squeezed = s.replace(/0/g, '') || '0'
    const names = PLACE_NAMES.slice(0, s.length).reverse()
    const sum = [...s].map((d, i) => `${d} ${d === '1' ? names[i].replace(/s$/, '') : names[i]}`).join(', ')
    return [
      `Here are ${p.number} things counted the oldest way: one stroke each.${p.number > 60 ? ' Only the first sixty are drawn.' : ''} Can you read the total at a glance?`,
      'Group them instead. Ten ones make a ten, and ten tens make a hundred. Count what lands in each column.',
      'Babylonian scribes wrote only the count in each column. Where a column was empty, they left a gap.',
      `But a gap is easy to lose. Close it up, and ${p.number} reads as ${squeezed}.`,
      "So a sign for 'nothing here' was needed: zero. Indian mathematicians made it a number in its own right.",
      `Now each place sets a digit's worth: ${sum}. That is ${p.number}.`
    ]
  },
  body: String.raw`
        n = int(P["number"])
        digits = str(n)
        names = ["ones", "tens", "hundreds", "thousands"][: len(digits)][::-1]
        shown = min(n, 60)
        groups = VGroup()
        for g in range((shown + 4) // 5):
            cnt = min(5, shown - g * 5)
            marks = VGroup(*[Line(UP * 0.32, DOWN * 0.32, color=INK, stroke_width=3).shift(RIGHT * 0.13 * j) for j in range(min(cnt, 4))])
            if cnt == 5:
                marks.add(Line(LEFT * 0.1 + DOWN * 0.24, RIGHT * 0.5 + UP * 0.24, color=ACCENT, stroke_width=3))
            groups.add(marks)
        groups.arrange_in_grid(cols=6, buff=(0.5, 0.35))
        if groups.width > 11:
            groups.scale_to_fit_width(11)
        title = Words(f"{n} as tally marks", 30, MUTED).to_edge(UP)
        groups.next_to(title, DOWN, buff=0.5)
        extra = [Words(f"… and {n - shown} more", 26, MUTED).next_to(groups, DOWN, buff=0.3)] if n > shown else []
        self.beat(0, FadeIn(title), LaggedStart(*[Create(g) for g in groups], lag_ratio=0.04), *[FadeIn(e) for e in extra])

        boxes = VGroup(*[RoundedRectangle(corner_radius=0.12, width=2.0, height=3.4, color=LINE, stroke_width=2) for _ in digits]).arrange(RIGHT, buff=0.35).shift(UP * 0.2)
        heads = VGroup(*[Words(nm, 26, MUTED).next_to(b, UP, buff=0.2) for nm, b in zip(names, boxes)])
        stacks = VGroup()
        for d, b in zip(digits, boxes):
            k = int(d)
            st = VGroup(*[RoundedRectangle(corner_radius=0.05, width=0.9, height=0.26, color=C1, fill_color=C1, fill_opacity=0.85, stroke_width=0) for _ in range(k)])
            if k:
                st.arrange(UP, buff=0.07).move_to(b.get_bottom() + UP * (0.25 + st.height / 2))
            stacks.add(st)
        self.beat(1, FadeOut(groups), FadeOut(title), *[FadeOut(e) for e in extra], FadeIn(boxes), FadeIn(heads), LaggedStart(*[FadeIn(s, shift=DOWN * 0.3) for s in stacks if len(s)], lag_ratio=0.3))

        marks = VGroup()
        for d, b in zip(digits, boxes):
            marks.add(Words(d if d != "0" else " ", 64, INK).next_to(b, DOWN, buff=0.35))
        gaps = VGroup(*[DashedLine(b.get_bottom() + DOWN * 0.95 + LEFT * 0.35, b.get_bottom() + DOWN * 0.95 + RIGHT * 0.35, color=MUTED) for d, b in zip(digits, boxes) if d == "0"])
        self.beat(2, *[Write(m) for m, d in zip(marks, digits) if d != "0"], Create(gaps))

        kept = [m for m, d in zip(marks, digits) if d != "0"]
        homes = [m.get_center() for m in kept]
        row = VGroup(*[m.copy() for m in kept]).arrange(RIGHT, buff=0.15).move_to(VGroup(*kept).get_center())
        q = Words("?", 64, ACCENT).next_to(row, RIGHT, buff=0.3)
        self.beat(3, FadeOut(gaps), *[m.animate.move_to(r.get_center()) for m, r in zip(kept, row)], FadeIn(q))

        zeros = VGroup(*[Words("0", 64, ACCENT).next_to(b, DOWN, buff=0.35) for d, b in zip(digits, boxes) if d == "0"])
        self.beat(4, FadeOut(q), *[m.animate.move_to(h) for m, h in zip(kept, homes)], FadeIn(zeros, scale=1.4))

        parts = " + ".join(f"{d}\\times {10 ** (len(digits) - 1 - i)}" for i, d in enumerate(digits))
        eq = Eq(parts + f" = {n}", size=40).to_edge(DOWN, buff=0.35)
        self.beat(5, FadeOut(stacks), Write(eq))
`
}

const det = (m: number[][]) => m[0][0] * m[1][1] - m[0][1] * m[1][0]

const linearMap: AnimTemplate = {
  id: 'linear-map',
  title: 'A matrix moves the whole plane',
  area: 'linear-algebra',
  fits: /\b(linear (maps?|transformations?)|matri(x|ces)|basis vectors?|vectors?|determinants?|shear|rotation matri\w*)\b/i,
  explore: 'matrix',
  describe: 'The grid, î and ĵ, a vector v = x î + y ĵ and the unit square; then the matrix moves all of it at once, and v lands at x·(new î) + y·(new ĵ); the square\'s new area is the determinant.',
  params: {
    matrix: { kind: 'matrix', default: [[1, 1], [0, 1]], min: -3, max: 3, describe: '[[a, b], [c, d]]: its columns are where î and ĵ land' },
    vector: { kind: 'vector', default: [1, 2], min: -3, max: 3, describe: 'v = [x, y]' }
  },
  beats(p) {
    const [[a, b], [c, d]] = p.matrix as number[][]
    const [x, y] = p.vector as number[]
    const D = det(p.matrix)
    return [
      'Start with the grid of the plane, and the two unit steps that build it.',
      `Call them i-hat and j-hat. Watch where they go: the matrix's first column, (${fmt(a)}, ${fmt(c)}), is where i-hat lands, and the second, (${fmt(b)}, ${fmt(d)}), is where j-hat lands.`,
      `Here is v: ${fmt(x)} steps of i-hat and ${fmt(y)} of j-hat.`,
      'Now apply the matrix to everything at once. Grid lines stay straight, parallel, and evenly spaced.',
      `v keeps its recipe: ${fmt(x)} of the new i-hat plus ${fmt(y)} of the new j-hat, landing at (${fmt(a * x + b * y)}, ${fmt(c * x + d * y)}). The unit square's area became ${fmt(D)}: the determinant.${D === 0 ? ' Zero: the plane is squashed onto a line.' : D < 0 ? ' Negative: the plane was flipped over.' : ''}`
    ]
  },
  body: String.raw`
        M = np.array(P["matrix"], dtype=float)
        v = np.array(P["vector"], dtype=float)
        plane = NumberPlane(x_range=[-9, 9, 1], y_range=[-6, 6, 1], background_line_style={"stroke_color": LINE, "stroke_width": 1.5, "stroke_opacity": 1}, axis_config={"stroke_color": MUTED, "stroke_width": 2})
        square = Polygon(ORIGIN, RIGHT, RIGHT + UP, UP, color=ACCENT, fill_color=ACCENT, fill_opacity=0.18, stroke_width=0)
        ih = Arrow(ORIGIN, RIGHT, buff=0, color=C1, stroke_width=6, max_tip_length_to_length_ratio=0.25)
        jh = Arrow(ORIGIN, UP, buff=0, color=C2, stroke_width=6, max_tip_length_to_length_ratio=0.25)
        vv = Arrow(ORIGIN, [v[0], v[1], 0], buff=0, color=ACCENT, stroke_width=6, max_tip_length_to_length_ratio=0.15)
        self.beat(0, Create(plane), run_time=1.5)
        il = Eq(r"\hat{\imath}", C1).next_to(ih, DOWN, buff=0.1)
        jl = Eq(r"\hat{\jmath}", C2).next_to(jh, LEFT, buff=0.1)
        self.beat(1, GrowArrow(ih), GrowArrow(jh), FadeIn(square), FadeIn(il), FadeIn(jl))
        card = VGroup(Eq(r"v = %g\,\hat{\imath} + %g\,\hat{\jmath}" % (v[0], v[1]), ACCENT, 38))
        card.add_background_rectangle(color=BG, opacity=0.9, buff=0.15)
        card.to_corner(UL, buff=0.3)
        self.beat(2, GrowArrow(vv), FadeIn(card))
        mat = Eq(r"\begin{bmatrix} %g & %g \\ %g & %g \end{bmatrix}" % (M[0][0], M[0][1], M[1][0], M[1][1]), INK, 40) if HAS_TEX else Words("[[%g, %g], [%g, %g]]" % (M[0][0], M[0][1], M[1][0], M[1][1]), 30)
        mat.add_background_rectangle(color=BG, opacity=0.9, buff=0.15)
        mat.to_corner(UR, buff=0.3)
        self.add(mat)
        self.beat(3, FadeOut(il), FadeOut(jl), ApplyMatrix(M, VGroup(plane, square, ih, jh, vv)), run_time=2.5)
        w = M @ v
        res = VGroup(Eq(r"Mv = (%g,\ %g)" % (w[0], w[1]), ACCENT, 38), Words("area × %g" % round(np.linalg.det(M), 3), 28, MUTED)).arrange(DOWN, aligned_edge=LEFT)
        res.add_background_rectangle(color=BG, opacity=0.9, buff=0.15)
        res.next_to(card, DOWN, aligned_edge=LEFT)
        self.beat(4, FadeIn(res), Indicate(vv, color=ACCENT))
`
}

function eigenvalues(m: number[][]): number[] | null {
  const tr = m[0][0] + m[1][1]
  const disc = tr * tr - 4 * det(m)
  if (disc < 0) return null
  return [(tr + Math.sqrt(disc)) / 2, (tr - Math.sqrt(disc)) / 2]
}

const eigen: AnimTemplate = {
  id: 'eigen',
  title: 'Eigenvectors: the directions a matrix only stretches',
  area: 'linear-algebra',
  fits: /\b(eigen\w*|characteristic (polynomial|equation)|diagonali[sz]\w*|principal components?|pca|power iteration)\b/i,
  explore: 'eigen',
  describe: 'A fan of vectors, each with its own line; the matrix turns most of them off their lines, while the eigenvectors stay on theirs, only stretched by λ; then Av = λv.',
  params: { matrix: { kind: 'matrix', default: [[2, 1], [1, 2]], min: -3, max: 3, describe: '[[a, b], [c, d]]' } },
  beats(p) {
    const ev = eigenvalues(p.matrix)
    return [
      'Here are vectors pointing every which way, each drawn with the line through it.',
      'Apply the matrix. Most vectors are knocked off their own line.',
      ev
        ? ev[0] === ev[1]
          ? `A few stay on their line, only stretched, by ${fmt(ev[0])}. Those are the eigenvectors.`
          : `But along two directions, vectors stay on their line, only stretched: by ${fmt(ev[0])} on one and ${fmt(ev[1])} on the other. Those are the eigenvectors, and the stretches are the eigenvalues.`
        : 'This one turns every direction: no vector stays on its line. Its eigenvalues are complex, which is how rotation shows up.',
      ev ? 'That is all the equation says: A times v is just a number times v.' : 'Still the question is the same: is there a v with A v equal to a number times v?'
    ]
  },
  body: String.raw`
        M = np.array(P["matrix"], dtype=float)
        vals, vecs = np.linalg.eig(M)
        real = bool(np.all(np.abs(np.imag(vals)) < 1e-9))
        plane = NumberPlane(x_range=[-9, 9, 1], y_range=[-6, 6, 1], background_line_style={"stroke_color": LINE, "stroke_width": 1, "stroke_opacity": 0.7}, axis_config={"stroke_color": MUTED})
        self.add(plane)
        dirs = [np.array([np.cos(a), np.sin(a)]) for a in np.linspace(0, np.pi, 8, endpoint=False)]
        eig = []
        if real:
            for k in range(2):
                e = np.real(vecs[:, k])
                e = e / np.linalg.norm(e)
                if not any(abs(abs(float(np.dot(e, d))) - 1) < 1e-6 for d in dirs):
                    dirs.append(e)
                eig.append((e, float(np.real(vals[k]))))
        scale = 1.6 / max(1.0, float(np.max(np.abs(np.real(vals)))) if real else 1.4)
        arrows = VGroup()
        lines = VGroup()
        for d in dirs:
            tip = np.array([d[0], d[1], 0]) * 1.6
            arrows.add(Arrow(ORIGIN, tip, buff=0, color=MUTED, stroke_width=5, max_tip_length_to_length_ratio=0.18))
            lines.add(Line(-tip * 4, tip * 4, color=MUTED, stroke_width=1.5, stroke_opacity=0.6))
        self.beat(0, Create(lines), LaggedStart(*[GrowArrow(a) for a in arrows], lag_ratio=0.1))
        stays = []
        for idx, d in enumerate(dirs):
            if any(abs(abs(float(np.dot(e, d))) - 1) < 1e-6 for e, _ in eig):
                stays.append(idx)
        self.beat(1, ApplyMatrix(M, arrows), run_time=2.5)
        if real:
            hl = []
            for idx in stays:
                hl.append(arrows[idx].animate.set_color(ACCENT))
                hl.append(lines[idx].animate.set_color(ACCENT).set_stroke(width=3, opacity=1))
            labels = VGroup()
            for e, lam in eig:
                tip = np.array([e[0], e[1], 0]) * 1.6 * lam
                labels.add(Eq(r"\lambda = %g" % round(lam, 3), ACCENT, 36).next_to(tip, UR if e[0] * e[1] >= 0 else UL, buff=0.15))
            self.beat(2, *hl, FadeIn(labels))
        else:
            self.beat(2, Wiggle(arrows))
        eq = Eq(r"A\vec{v} = \lambda \vec{v}", ACCENT, 52).to_edge(DOWN, buff=0.5)
        eq.add_background_rectangle(color=BG, opacity=0.9, buff=0.15)
        self.beat(3, Write(eq))
`
}

const SAFE_FN = String.raw`
_NS = {"sin": np.sin, "cos": np.cos, "tan": np.tan, "exp": np.exp, "ln": np.log, "log": np.log, "sqrt": np.sqrt, "abs": np.abs, "asin": np.arcsin, "acos": np.arccos, "atan": np.arctan, "sinh": np.sinh, "cosh": np.cosh, "tanh": np.tanh, "pi": np.pi, "e": np.e}
def fx(expr, names="x"):
    code = compile(expr, "<formula>", "eval")
    def f(*a):
        with np.errstate(all="ignore"):
            return float(eval(code, {"__builtins__": {}}, {**_NS, **dict(zip(names, a))}))
    return f
def y_window(f, lo, hi, pad=0.15):
    ys = [f(x) for x in np.linspace(lo, hi, 200)]
    ys = [y for y in ys if np.isfinite(y)]
    a, b = (min(ys), max(ys)) if ys else (-1, 1)
    a, b = min(a, 0), max(b, 0)
    span = max(b - a, 1e-3)
    step = 10 ** np.floor(np.log10(span / 2))
    return [a - span * pad, b + span * pad, step]
`

const secant: AnimTemplate = {
  id: 'secant-limit',
  title: 'The derivative as the limit of secants',
  area: 'calculus',
  fits: /\b(derivatives?|differentiat\w*|tangent( lines?)?|secants?|rates? of change|instantaneous|first principles|slopes? of a curve|newton|leibniz)\b/i,
  explore: 'secant',
  describe: 'f with a point at x0 and a second point h further on; the secant through them, its slope shown, as h shrinks toward 0 until the secant becomes the tangent; then the limit definition.',
  params: {
    f: { kind: 'formula', default: 'x^2', describe: 'a formula in x' },
    x0: { kind: 'number', default: 1, min: -5, max: 5, describe: 'where the tangent is' },
    h: { kind: 'number', default: 2, min: 0.5, max: 4, describe: 'the starting gap' }
  },
  beats(p) {
    return [
      `Here is the curve y = ${String(p.f).replace(/\*\*/g, '^').replace(/\*/g, '')}. How steep is it at x = ${fmt(p.x0)}? One point alone has no slope.`,
      `So take a second point, h = ${fmt(p.h)} further along, and join them: a secant. Its slope is rise over run.`,
      'Bring the second point closer. The slope changes, but less and less.',
      'Closer still: h is a hundredth, then a thousandth. The slope is settling on one number.',
      'In the limit the secant becomes the tangent, and that number is the derivative: the limit of rise over run as h goes to zero.'
    ]
  },
  body: String.raw`
        f = fx(P["f"])
        x0, h0 = float(P["x0"]), float(P["h"])
        lo, hi = x0 - 2.5, x0 + h0 + 1.5
        yr = y_window(f, lo, hi)
        axes = Axes(x_range=[lo, hi, 1], y_range=yr, x_length=10.5, y_length=5.6, axis_config={"color": MUTED, "include_tip": False}).shift(DOWN * 0.3)
        graph = axes.plot(f, x_range=[lo, hi, (hi - lo) / 200], color=C1, stroke_width=4)
        self.beat(0, Create(axes), Create(graph), FadeIn(Dot(axes.c2p(x0, f(x0)), color=INK)))
        h = ValueTracker(h0)
        def slope():
            hh = h.get_value()
            return (f(x0 + hh) - f(x0)) / hh
        def line_for(m, color, width):
            l, r = lo, hi
            return Line(axes.c2p(l, f(x0) + m * (l - x0)), axes.c2p(r, f(x0) + m * (r - x0)), color=color, stroke_width=width)
        sec = always_redraw(lambda: line_for(slope(), ACCENT, 3))
        q = always_redraw(lambda: Dot(axes.c2p(x0 + h.get_value(), f(x0 + h.get_value())), color=ACCENT))
        hl = Words("h =", 30, MUTED)
        hv = always_redraw(lambda: Num(h.get_value(), 3).next_to(hl, RIGHT, buff=0.15))
        sl = Words("slope =", 30, MUTED)
        sv = always_redraw(lambda: Num(slope(), 4, color=ACCENT).next_to(sl, RIGHT, buff=0.15))
        panel = VGroup(VGroup(hl, Num(h0, 3).next_to(hl, RIGHT, buff=0.15)), VGroup(sl, Num(0, 4).next_to(sl, RIGHT, buff=0.15))).arrange(DOWN, aligned_edge=LEFT).to_corner(UL, buff=0.4)
        bg = BackgroundRectangle(panel, color=BG, fill_opacity=0.9, buff=0.2)
        self.add(bg)
        self.add(hl, sl)
        self.beat(1, Create(sec), FadeIn(q), FadeIn(hv), FadeIn(sv))
        self.beat(2, h.animate.set_value(h0 / 4), run_time=2.5)
        self.beat(3, h.animate.set_value(0.001), run_time=3)
        d = (f(x0 + 1e-6) - f(x0 - 1e-6)) / 2e-6
        tangent = line_for(d, ACCENT, 5)
        defn = Eq(r"f'(x_0)=\lim_{h\to 0}\frac{f(x_0+h)-f(x_0)}{h}", INK, 40).to_edge(DOWN, buff=0.25)
        defn.add_background_rectangle(color=BG, opacity=0.9, buff=0.12)
        self.beat(4, FadeOut(sec), Create(tangent), Write(defn))
`
}

const riemann: AnimTemplate = {
  id: 'riemann',
  title: 'The integral as the limit of rectangles',
  area: 'calculus',
  fits: /\b(integra(ls?|tion)|riemann|area under|antiderivatives?|fundamental theorem|definite integrals?)\b/i,
  explore: 'riemann',
  describe: 'The area under f from a to b, covered by n rectangles for each n in ns, their total shown each time, closing in on the exact area.',
  params: {
    f: { kind: 'formula', default: 'x^2', describe: 'a formula in x' },
    a: { kind: 'number', default: 0, min: -6, max: 6, describe: 'left end' },
    b: { kind: 'number', default: 2, min: -6, max: 8, describe: 'right end' },
    ns: { kind: 'numbers', default: [2, 4, 8, 32], min: 1, max: 200, maxItems: 5, describe: 'how many rectangles, each time' },
    rule: { kind: 'enum', default: 'left', options: ['left', 'right', 'mid'], describe: 'where each rectangle meets the curve' }
  },
  check: (p) => (p.b > p.a ? null : 'b: it must be greater than a'),
  beats(p) {
    const ns = p.ns as number[]
    return [
      `We want the area under this curve from ${fmt(p.a)} to ${fmt(p.b)}. Curved edges have no formula for area, but rectangles do.`,
      ...ns.map((n, i) =>
        i === 0 ? `Cover it with ${n} rectangle${n === 1 ? '' : 's'}, each as tall as the curve at its ${p.rule === 'mid' ? 'middle' : p.rule + ' edge'}. Their total is a rough estimate.` : i === ns.length - 1 ? `With ${n}, the error is a sliver.` : `${n} rectangles: thinner, and the gaps shrink.`
      ),
      'In the limit of infinitely many, infinitely thin rectangles, the sum becomes the integral: the exact area.'
    ]
  },
  body: String.raw`
        f = fx(P["f"])
        a, b = float(P["a"]), float(P["b"])
        lo, hi = a - (b - a) * 0.25, b + (b - a) * 0.25
        yr = y_window(f, lo, hi)
        axes = Axes(x_range=[lo, hi, max(0.5, round((hi - lo) / 8, 1))], y_range=yr, x_length=10.5, y_length=5.4, axis_config={"color": MUTED, "include_tip": False}).shift(DOWN * 0.35)
        graph = axes.plot(f, x_range=[lo, hi, (hi - lo) / 200], color=C1, stroke_width=4)
        area = axes.get_area(graph, x_range=[a, b], color=ACCENT, opacity=0.25)
        self.beat(0, Create(axes), Create(graph), FadeIn(area))
        kind = {"left": "left", "right": "right", "mid": "center"}[P["rule"]]
        def rects(n):
            return axes.get_riemann_rectangles(graph, x_range=[a, b], dx=(b - a) / n, input_sample_type=kind, color=(C1, C2), fill_opacity=0.6, stroke_width=1, stroke_color=BG)
        def total(n):
            dx = (b - a) / n
            xs = [a + dx * (k + {"left": 0, "right": 1, "center": 0.5}[kind]) for k in range(n)]
            return sum(f(x) * dx for x in xs)
        exact = sum(f(a + (b - a) * (k + 0.5) / 20000) for k in range(20000)) * (b - a) / 20000
        cur = None
        label = None
        for i, n in enumerate(P["ns"]):
            n = int(n)
            r = rects(n)
            lab = Words(f"{n} rectangles:  {total(n):.4f}", 30).to_corner(UL, buff=0.4)
            lab.add_background_rectangle(color=BG, opacity=0.9, buff=0.12)
            if cur is None:
                self.beat(1 + i, FadeOut(area), Create(r), FadeIn(lab))
            else:
                self.beat(1 + i, ReplacementTransform(cur, r), ReplacementTransform(label, lab))
            cur, label = r, lab
        last = Eq(r"\int_{%g}^{%g} f(x)\,dx = %.4f" % (a, b, exact), ACCENT, 42).to_corner(UR, buff=0.4)
        last.add_background_rectangle(color=BG, opacity=0.9, buff=0.12)
        self.beat(1 + len(P["ns"]), FadeIn(area), Write(last))
`
}

const gradient: AnimTemplate = {
  id: 'gradient-descent',
  title: 'Gradient descent on a loss surface',
  area: 'calculus',
  fits: /\b(gradient descent|gradients?|loss (surface|function|landscape)|learning rates?|optimi[sz]\w*|minimi[sz]\w*|stochastic gradient|sgd|training a model)\b/i,
  describe: 'A loss surface over two weights as a colour map (deeper colour is lower), a start point and its gradient arrow, then the steps of gradient descent with the loss shown, shrinking as the ground flattens.',
  params: {
    loss: { kind: 'formula2', default: 'x^2 + 3*y^2', describe: 'the loss as a formula in x and y, over −3 ≤ x ≤ 3, −2 ≤ y ≤ 2' },
    start: { kind: 'vector', default: [2.5, 1.5], min: -3, max: 3, describe: 'the starting weights [x, y]' },
    rate: { kind: 'number', default: 0.1, min: 0.001, max: 1, describe: 'the learning rate' },
    steps: { kind: 'int', default: 15, min: 1, max: 40, describe: 'how many steps' }
  },
  beats(p) {
    return [
      'This map is a loss surface: every point is a choice of two weights, and the deeper the colour, the lower the loss. Training means finding the lowest point.',
      `Start here. The gradient points straight uphill, so step the opposite way, scaled by the learning rate, ${fmt(p.rate, 3)}.`,
      'Each step: measure the slope where you stand, and move against it.',
      `After ${p.steps} steps, look at their lengths. Near the bottom the slope flattens, so the steps shrink on their own.`,
      p.rate >= 0.3 ? 'Try a smaller learning rate and the path is calmer. Too large, and it overshoots and bounces across the valley.' : 'A larger learning rate takes bigger strides, but too large and it overshoots and bounces across the valley.'
    ]
  },
  body: String.raw`
        L = fx(P["loss"], "xy")
        axes = Axes(x_range=[-3, 3, 1], y_range=[-2, 2, 1], x_length=9.6, y_length=6.4, axis_config={"color": MUTED, "include_tip": False}).shift(LEFT * 1.4)
        nx, ny = 48, 32
        vals = np.array([[L(-3 + 6 * (i + 0.5) / nx, -2 + 4 * (j + 0.5) / ny) for i in range(nx)] for j in range(ny)])
        finite = vals[np.isfinite(vals)]
        lo, hi = (float(finite.min()), float(finite.max())) if finite.size else (0.0, 1.0)
        cells = VGroup()
        w, hgt = 9.6 / nx, 6.4 / ny
        for j in range(ny):
            for i in range(nx):
                v = vals[j, i]
                t = 0.0 if not np.isfinite(v) else ((v - lo) / (hi - lo + 1e-12)) ** 0.5
                c = interpolate_color(ManimColor(C1), ManimColor(BG), t)
                cells.add(Rectangle(width=w, height=hgt, stroke_width=0, fill_color=c, fill_opacity=1).move_to(axes.c2p(-3 + 6 * (i + 0.5) / nx, -2 + 4 * (j + 0.5) / ny)))
        self.beat(0, FadeIn(cells), Create(axes))
        def grad(x, y, e=1e-5):
            return np.array([(L(x + e, y) - L(x - e, y)) / (2 * e), (L(x, y + e) - L(x, y - e)) / (2 * e)])
        p = np.array(P["start"], dtype=float)
        rate = float(P["rate"])
        dot = Dot(axes.c2p(*p), color=ACCENT, radius=0.1)
        g = grad(*p)
        gn = g / (np.linalg.norm(g) + 1e-12)
        up = Arrow(axes.c2p(*p), axes.c2p(*(p + gn * 0.9)), buff=0, color=MUTED, stroke_width=5)
        down = Arrow(axes.c2p(*p), axes.c2p(*(p - gn * 0.9)), buff=0, color=ACCENT, stroke_width=5)
        ll = Words("loss", 28, MUTED)
        lv = Num(L(*p), 4, color=ACCENT)
        sl = Words("step", 28, MUTED)
        sv = Integer(0, font_size=30, color=INK)
        panel = VGroup(VGroup(ll, lv).arrange(RIGHT), VGroup(sl, sv).arrange(RIGHT)).arrange(DOWN, aligned_edge=LEFT).to_corner(UR, buff=0.5)
        self.beat(1, FadeIn(dot, scale=2), GrowArrow(up), GrowArrow(down), FadeIn(panel))
        pts = [p.copy()]
        for _ in range(int(P["steps"])):
            p = p - rate * grad(*p)
            p = np.clip(p, [-3, -2], [3, 2])
            pts.append(p.copy())
        first = min(4, len(pts) - 1)
        def walk(a, b):
            out = []
            for k in range(a, b):
                out.append(Line(axes.c2p(*pts[k]), axes.c2p(*pts[k + 1]), color=ACCENT, stroke_width=3))
            return out
        segs = walk(0, first)
        with self.during(2):
            self.play(FadeOut(up), FadeOut(down), run_time=0.4)
            for k, s in enumerate(segs):
                self.play(Create(s), dot.animate.move_to(axes.c2p(*pts[k + 1])), lv.animate.set_value(L(*pts[k + 1])), sv.animate.set_value(k + 1), run_time=0.5)
        rest = walk(first, len(pts) - 1)
        with self.during(3):
            for k, s in enumerate(rest):
                self.play(Create(s), dot.animate.move_to(axes.c2p(*pts[first + k + 1])), lv.animate.set_value(L(*pts[first + k + 1])), sv.animate.set_value(first + k + 1), run_time=max(0.12, 1.8 / max(1, len(rest))))
        self.beat(4, Indicate(dot, color=ACCENT, scale_factor=1.8))
`
}

const backprop: AnimTemplate = {
  id: 'backprop',
  title: 'Backpropagation through a tiny network',
  area: 'calculus',
  fits: /\b(backprop\w*|back[- ]propagation|chain rule|neural (nets?|networks?)|perceptrons?|multilayer|mlp|automatic differentiation|autodiff)\b/i,
  describe: 'Two inputs, two tanh hidden units and one output: the forward pass fills in each value, the loss against the target, then the chain rule sends the error back and each weight gets its gradient, then one update and the smaller loss.',
  params: {
    x: { kind: 'vector', default: [1, 0.5], min: -3, max: 3, describe: 'the inputs [x1, x2]' },
    target: { kind: 'number', default: 1, min: -3, max: 3, describe: 'the output it should give' },
    rate: { kind: 'number', default: 0.5, min: 0.01, max: 2, describe: 'the learning rate for the one update' }
  },
  beats(p) {
    return [
      'A tiny network: two inputs, two hidden units, one output. Each line is a weight.',
      'Forward pass: each hidden unit adds up its weighted inputs and squashes the sum with tanh. The output adds up the hidden values.',
      `Compare the output with the target, ${fmt(p.target)}. The loss is half the squared error.`,
      "Backward pass: the chain rule. The error at the output flows back along each line, and each weight's gradient is the error arriving at its unit times the value that came through it.",
      `Step every weight against its gradient, with learning rate ${fmt(p.rate)}, and run forward again: the loss is smaller.`
    ]
  },
  body: String.raw`
        x = np.array(P["x"], dtype=float)
        t = float(P["target"])
        lr = float(P["rate"])
        W1 = np.array([[0.6, -0.4], [0.3, 0.8]])
        w2 = np.array([0.7, -0.5])
        def forward(W1, w2):
            z = W1 @ x
            hdn = np.tanh(z)
            y = float(w2 @ hdn)
            return z, hdn, y, 0.5 * (y - t) ** 2
        z, hdn, y, loss = forward(W1, w2)
        dy = y - t
        g2 = dy * hdn
        dh = dy * w2 * (1 - hdn ** 2)
        g1 = np.outer(dh, x)
        IN = [LEFT * 4.6 + UP * 1.3, LEFT * 4.6 + DOWN * 1.3]
        HID = [LEFT * 0.8 + UP * 1.6, LEFT * 0.8 + DOWN * 1.6]
        OUT = RIGHT * 3 + DOWN * 0
        def node(pos, color=INK):
            return Circle(radius=0.48, color=color, stroke_width=3).set_fill(BG, 1).move_to(pos)
        nodes = VGroup(*[node(p, C1) for p in IN], *[node(p, C2) for p in HID], node(OUT, ACCENT))
        edges1 = [[Line(IN[i], HID[j], color=LINE, stroke_width=3) for i in range(2)] for j in range(2)]
        edges2 = [Line(HID[j], OUT, color=LINE, stroke_width=3) for j in range(2)]
        for row in edges1:
            for e in row:
                e.put_start_and_end_on(e.get_start() + (e.get_end() - e.get_start()) / np.linalg.norm(e.get_end() - e.get_start()) * 0.48, e.get_end() - (e.get_end() - e.get_start()) / np.linalg.norm(e.get_end() - e.get_start()) * 0.48)
        for e in edges2:
            e.put_start_and_end_on(e.get_start() + (e.get_end() - e.get_start()) / np.linalg.norm(e.get_end() - e.get_start()) * 0.48, e.get_end() - (e.get_end() - e.get_start()) / np.linalg.norm(e.get_end() - e.get_start()) * 0.48)
        def wl(line, v, color=MUTED, frac=0.3):
            p = line.point_from_proportion(frac)
            return Words("%.2f" % v, 22, color).move_to(p + UP * 0.22)
        wlabels = VGroup(*[wl(edges1[j][i], W1[j][i], frac=0.28 if i == j else 0.5) for j in range(2) for i in range(2)], *[wl(edges2[j], w2[j], frac=0.5) for j in range(2)])
        names = VGroup(Words("x₁", 24, MUTED).next_to(nodes[0], LEFT), Words("x₂", 24, MUTED).next_to(nodes[1], LEFT), Words("output", 24, MUTED).next_to(nodes[4], DOWN))
        self.beat(0, *[Create(e) for row in edges1 for e in row], *[Create(e) for e in edges2], FadeIn(nodes), FadeIn(wlabels), FadeIn(names))
        def val(v, at, color=INK):
            return Words("%.2f" % v, 24, color).move_to(at)
        xin = VGroup(val(x[0], IN[0]), val(x[1], IN[1]))
        hv = VGroup(val(hdn[0], HID[0]), val(hdn[1], HID[1]))
        yv = val(y, OUT)
        with self.during(1):
            self.play(FadeIn(xin), run_time=0.6)
            self.play(*[ShowPassingFlash(e.copy().set_color(C1).set_stroke(width=6), time_width=0.6) for row in edges1 for e in row], run_time=0.9)
            self.play(FadeIn(hv), run_time=0.5)
            self.play(*[ShowPassingFlash(e.copy().set_color(C2).set_stroke(width=6), time_width=0.6) for e in edges2], run_time=0.8)
            self.play(FadeIn(yv), run_time=0.5)
        lossbox = VGroup(Words("target %.2f" % t, 26, MUTED), Eq(r"L=\tfrac{1}{2}(y-t)^2 = %.3f" % loss, ACCENT, 36)).arrange(DOWN, aligned_edge=LEFT).to_corner(UR, buff=0.4)
        self.beat(2, FadeIn(lossbox))
        glabels = VGroup(*[wl(edges1[j][i], g1[j][i], ACCENT, frac=0.28 if i == j else 0.5) for j in range(2) for i in range(2)], *[wl(edges2[j], g2[j], ACCENT, frac=0.5) for j in range(2)])
        dyl = Eq(r"\partial L/\partial y = %.2f" % dy, ACCENT, 30).next_to(nodes[4], UP, buff=0.25)
        with self.during(3):
            self.play(FadeIn(dyl), run_time=0.6)
            self.play(*[ShowPassingFlash(Line(e.get_end(), e.get_start()).set_color(ACCENT).set_stroke(width=7), time_width=0.6) for e in edges2], run_time=0.9)
            self.play(*[Transform(wlabels[4 + j], glabels[4 + j]) for j in range(2)], run_time=0.6)
            self.play(*[ShowPassingFlash(Line(e.get_end(), e.get_start()).set_color(ACCENT).set_stroke(width=7), time_width=0.6) for row in edges1 for e in row], run_time=0.9)
            self.play(*[Transform(wlabels[k], glabels[k]) for k in range(4)], run_time=0.6)
        W1n, w2n = W1 - lr * g1, w2 - lr * g2
        _, h2, y2, loss2 = forward(W1n, w2n)
        newl = Eq(r"L = %.3f" % loss2, ACCENT, 36).next_to(lossbox, DOWN, aligned_edge=LEFT)
        newlabels = VGroup(*[wl(edges1[j][i], W1n[j][i], frac=0.28 if i == j else 0.5) for j in range(2) for i in range(2)], *[wl(edges2[j], w2n[j], frac=0.5) for j in range(2)])
        self.beat(4, FadeOut(dyl), *[Transform(wlabels[k], newlabels[k]) for k in range(6)], Transform(hv, VGroup(val(h2[0], HID[0]), val(h2[1], HID[1]))), Transform(yv, val(y2, OUT)), FadeIn(newl))
`
}

const attention: AnimTemplate = {
  id: 'attention',
  title: 'Attention: a weighted average decided by dot products',
  area: 'linear-algebra',
  fits: /\b(attention|transformers?|self[- ]attention|queries|keys and values|softmax|llms?|language models?)\b/i,
  describe: 'A short sentence; one word asks which others matter to it: query·key scores as bars, softmax turning them into weights that sum to 1, lines to each word as thick as its weight, and the new meaning as the weighted average of values.',
  params: {
    words: { kind: 'words', default: ['The', 'cat', 'sat', 'on', 'the', 'mat'], maxItems: 7, describe: 'the sentence, one token each (2 to 7)' },
    focus: { kind: 'int', default: 2, min: 0, max: 6, describe: 'which word asks (counted from 0)' },
    scores: { kind: 'numbers', default: [], min: -6, max: 6, maxItems: 7, describe: 'optional: the query·key score for each word; made up from fixed embeddings when empty' }
  },
  check: (p) => (p.focus >= (p.words as string[]).length ? 'focus: it must be one of the words (counted from 0)' : (p.scores as number[]).length && (p.scores as number[]).length !== (p.words as string[]).length ? 'scores: one per word' : null),
  beats(p) {
    const w = (p.words as string[])[p.focus]
    return [
      `A sentence, one token at a time. Take "${w}": which other words should shape what it means here?`,
      `"${w}" sends out a query, and every word offers a key. Each score is the dot product of the query with that key: big when they point the same way.`,
      'Softmax turns the scores into weights: all positive, adding up to one. Bigger scores win more than their share.',
      `Now "${w}" listens to every word, as much as its weight says.`,
      `Its new vector is the weighted average of the words' values. That is one attention head; a transformer runs many at once.`
    ]
  },
  body: String.raw`
        words = list(P["words"])
        k = int(P["focus"])
        n = len(words)
        if P["scores"]:
            s = np.array(P["scores"], dtype=float)
        else:
            rng = np.random.default_rng(7)
            E = rng.normal(size=(n, 4))
            s = E @ E[k] / 2
        wts = np.exp(s - s.max())
        wts = wts / wts.sum()
        boxes = VGroup(*[VGroup(RoundedRectangle(corner_radius=0.1, width=1.5, height=0.7, color=ACCENT if i == k else LINE, stroke_width=3 if i == k else 2).set_fill(BG, 1), Words(wd, 26, ACCENT if i == k else INK)) for i, wd in enumerate(words)]).arrange(RIGHT, buff=0.25).move_to(DOWN * 1.1)
        for b in boxes:
            b[1].move_to(b[0])
        self.beat(0, LaggedStart(*[FadeIn(b, shift=UP * 0.2) for b in boxes], lag_ratio=0.1))
        base = boxes.get_top() + UP * 0.35
        top = 2.3
        smax = max(1e-9, float(np.max(np.abs(s))))
        bars = VGroup()
        nums = VGroup()
        for i, b in enumerate(boxes):
            hgt = max(0.04, abs(s[i]) / smax * top)
            r = Rectangle(width=0.9, height=hgt, stroke_width=0, fill_color=C1 if s[i] >= 0 else NEG, fill_opacity=0.8)
            r.move_to([b.get_center()[0], base[1] + hgt / 2, 0])
            bars.add(r)
            nums.add(Words("%.2f" % s[i], 22, MUTED).next_to(r, UP, buff=0.08))
        head = Words("score = query · key", 28, MUTED).to_edge(UP, buff=0.3)
        self.beat(1, FadeIn(head), *[GrowFromEdge(r, DOWN) for r in bars], FadeIn(nums))
        wbars = VGroup()
        wnums = VGroup()
        wmax = float(wts.max())
        for i, b in enumerate(boxes):
            hgt = max(0.04, wts[i] / wmax * top)
            r = Rectangle(width=0.9, height=hgt, stroke_width=0, fill_color=ACCENT, fill_opacity=0.85)
            r.move_to([b.get_center()[0], base[1] + hgt / 2, 0])
            wbars.add(r)
            wnums.add(Words("%d%%" % round(wts[i] * 100), 22, ACCENT).next_to(r, UP, buff=0.08))
        head2 = Words("weight = softmax(score)", 28, MUTED).to_edge(UP, buff=0.3)
        self.beat(2, Transform(bars, wbars), Transform(nums, wnums), Transform(head, head2))
        arcs = VGroup()
        for i, b in enumerate(boxes):
            if i == k:
                continue
            arcs.add(ArcBetweenPoints(boxes[k].get_bottom() + DOWN * 0.05, b.get_bottom() + DOWN * 0.05, angle=PI / 2.2 if i > k else -PI / 2.2, color=ACCENT, stroke_width=1 + 16 * wts[i], stroke_opacity=0.4 + 0.6 * wts[i] / wmax))
        self.beat(3, FadeOut(bars), FadeOut(nums), FadeOut(head), LaggedStart(*[Create(a) for a in arcs], lag_ratio=0.15))
        order = sorted(range(n), key=lambda i: -wts[i])[:3]
        terms = " + ".join("%.2f\\,v_{\\text{%s}}" % (wts[i], words[i]) for i in order) + (r" + \ldots" if n > 3 else "")
        out = Eq(r"\text{new } v_{\text{%s}} = %s" % (words[k], terms), INK, 40)
        if out.width > 12.5:
            out.scale_to_fit_width(12.5)
        out.to_edge(UP, buff=0.5)
        self.beat(4, Write(out))
`
}

const fourier: AnimTemplate = {
  id: 'fourier',
  title: 'Fourier series: a shape built from sine waves',
  area: 'functions',
  fits: /\b(fourier|harmonics?|sine waves?|frequenc(y|ies)|signals?|periodic functions?|spectr(um|a)|trigonometric series)\b/i,
  describe: 'A target wave (square, sawtooth or triangle) drawn dashed; the first sine, then terms added one at a time up to terms, the partial sum closing in on the shape (with the Gibbs overshoot at jumps).',
  params: {
    wave: { kind: 'enum', default: 'square', options: ['square', 'sawtooth', 'triangle'], describe: 'the shape to build' },
    terms: { kind: 'int', default: 9, min: 2, max: 25, describe: 'how many sine terms by the end' }
  },
  beats(p) {
    return [
      `In 1807 Joseph Fourier, studying how heat spreads, claimed something outrageous: any repeating shape is a sum of plain sine waves. Here is a ${p.wave} wave.`,
      'Start with the single sine wave that fits it best. Close, but too round.',
      'Add the next sine, faster and smaller, to correct the error. Then another.',
      `With ${p.terms} terms, the sum hugs the shape.${p.wave === 'triangle' ? ' The corners sharpen as terms are added.' : ' Except right at the jumps, where it overshoots by about nine percent however many terms you add: the Gibbs phenomenon.'}`,
      'Every term is just an amplitude and a frequency. That list of amplitudes is the shape, written in the language of frequency.'
    ]
  },
  body: String.raw`
        wave = P["wave"]
        N = int(P["terms"])
        axes = Axes(x_range=[-2 * PI, 2 * PI, PI], y_range=[-1.6, 1.6, 0.5], x_length=11.5, y_length=5, axis_config={"color": MUTED, "include_tip": False}).shift(DOWN * 0.3)
        if wave == "square":
            target = lambda x: 1.0 if np.sin(x) >= 0 else -1.0
            term = lambda k, x: 4 / PI * np.sin((2 * k - 1) * x) / (2 * k - 1)
        elif wave == "sawtooth":
            target = lambda x: ((x + PI) % (2 * PI) - PI) / PI
            term = lambda k, x: 2 / PI * (-1) ** (k + 1) * np.sin(k * x) / k
        else:
            target = lambda x: 2 / PI * np.arcsin(np.sin(x))
            term = lambda k, x: 8 / PI ** 2 * (-1) ** (k - 1) * np.sin((2 * k - 1) * x) / (2 * k - 1) ** 2
        def partial(n):
            return axes.plot(lambda x: sum(term(k, x) for k in range(1, n + 1)), x_range=[-2 * PI, 2 * PI, 0.01], color=ACCENT, stroke_width=4)
        tgt = VGroup(*[DashedLine(axes.c2p(x0, target(x0 + 1e-6)), axes.c2p(x0 + 0.08, target(x0 + 0.08 - 1e-6)), color=C1, stroke_width=3, dash_length=0.06) for x0 in np.arange(-2 * PI, 2 * PI - 0.08, 0.08)])
        self.beat(0, Create(axes), Create(tgt), run_time=2)
        cur = partial(1)
        lab = Words("1 term", 30, ACCENT).to_corner(UL, buff=0.4)
        self.beat(1, Create(cur), FadeIn(lab))
        mid = [2, 3] if N > 3 else [2]
        with self.during(2):
            for n in mid:
                nxt = partial(n)
                self.play(Transform(cur, nxt), Transform(lab, Words(f"{n} terms", 30, ACCENT).to_corner(UL, buff=0.4)), run_time=1.0)
        with self.during(3):
            for n in range(mid[-1] + 1, N + 1):
                self.play(Transform(cur, partial(n)), Transform(lab, Words(f"{n} terms", 30, ACCENT).to_corner(UL, buff=0.4)), run_time=max(0.25, 2.4 / max(1, N - mid[-1])))
        amps = VGroup()
        for k in range(1, min(N, 9) + 1):
            a = abs(term(k, PI / (2 * (2 * k - 1)) if wave != "sawtooth" else PI / (2 * k)))
            amps.add(Rectangle(width=0.32, height=max(0.05, a * 1.6), stroke_width=0, fill_color=ACCENT, fill_opacity=0.85))
        amps.arrange(RIGHT, buff=0.12, aligned_edge=DOWN)
        box = VGroup(amps, Words("amplitudes", 22, MUTED).next_to(amps, DOWN, buff=0.12))
        box.add_background_rectangle(color=BG, opacity=0.9, buff=0.15)
        box.to_corner(UR, buff=0.35)
        self.beat(4, FadeIn(box, shift=UP * 0.2))
`
}

const clt: AnimTemplate = {
  id: 'clt',
  title: 'The central limit theorem: means pile into a bell',
  area: 'probability',
  fits: /\b(central limit|clt|sampling distributions?|sample means?|standard errors?|normal approximation|bell curve)\b/i,
  explore: 'clt',
  describe: 'Draws from a lopsided or flat distribution, then means of n draws piling up into a histogram batch by batch, then the normal curve N(μ, σ²/n) laid over them.',
  params: {
    dist: { kind: 'enum', default: 'exponential', options: ['exponential', 'uniform', 'dice'], describe: 'what each draw comes from' },
    n: { kind: 'int', default: 5, min: 1, max: 60, describe: 'draws averaged into each mean' },
    samples: { kind: 'int', default: 600, min: 100, max: 3000, describe: 'how many means' }
  },
  beats(p) {
    const shape = p.dist === 'exponential' ? 'lopsided: most draws are small, a few are large' : p.dist === 'uniform' ? 'flat: every value between 0 and 1 is equally likely' : 'flat over one to six'
    return [
      `Here are single draws from a ${p.dist === 'dice' ? 'fair die' : p.dist + ' distribution'}. The shape is ${shape}. Nothing like a bell.`,
      `Now take ${p.n} draws and average them. Plot that one mean. Then do it again, and again.`,
      'The means pile up, and a shape appears.',
      `A bell curve, centred on the true mean, with spread sigma over root ${p.n}. Whatever the starting shape, averages of enough draws come out normal. That's the central limit theorem.`
    ]
  },
  body: String.raw`
        rng = np.random.default_rng(11)
        dist, n, S = P["dist"], int(P["n"]), int(P["samples"])
        if dist == "exponential":
            draw = lambda size: rng.exponential(1.0, size)
            mu, sd, lo, hi = 1.0, 1.0, 0.0, 4.0
        elif dist == "uniform":
            draw = lambda size: rng.uniform(0, 1, size)
            mu, sd, lo, hi = 0.5, (1 / 12) ** 0.5, 0.0, 1.0
        else:
            draw = lambda size: rng.integers(1, 7, size).astype(float)
            mu, sd, lo, hi = 3.5, (35 / 12) ** 0.5, 0.5, 6.5
        bins = 30
        edges = np.linspace(lo, hi, bins + 1)
        width = edges[1] - edges[0]
        axes = Axes(x_range=[lo, hi, (hi - lo) / 4], y_range=[0, 1, 0.25], x_length=10.5, y_length=5, axis_config={"color": MUTED, "include_tip": False}, y_axis_config={"include_ticks": False, "stroke_opacity": 0}).shift(DOWN * 0.4)
        def bars(data, color):
            counts, _ = np.histogram(np.clip(data, lo, hi - 1e-9), edges)
            dens = counts / max(1, len(data)) / width
            top = max(dens.max(), 1e-9)
            return VGroup(*[Rectangle(width=axes.x_length / bins * 0.92, height=max(0.001, d / top * 4.4), stroke_width=0, fill_color=color, fill_opacity=0.8).move_to(axes.c2p(edges[i] + width / 2, 0), aligned_edge=DOWN) for i, d in enumerate(dens)]), top
        singles, _ = bars(draw(4000), C2)
        cap = Words("single draws", 28, MUTED).to_corner(UL, buff=0.4)
        self.beat(0, Create(axes), FadeIn(singles, shift=UP * 0.2), FadeIn(cap))
        means = draw((S, n)).mean(axis=1)
        sizes = [max(10, S // 30), max(40, S // 6), S // 2, S]
        first, _ = bars(means[: sizes[0]], ACCENT)
        lab = Words(f"means of {n}:  {sizes[0]}", 28, ACCENT).to_corner(UL, buff=0.4)
        self.beat(1, FadeOut(singles), Transform(cap, lab), FadeIn(first))
        cur = first
        with self.during(2):
            for k in sizes[1:]:
                nxt, top = bars(means[:k], ACCENT)
                self.play(Transform(cur, nxt), Transform(cap, Words(f"means of {n}:  {k}", 28, ACCENT).to_corner(UL, buff=0.4)), run_time=1.0)
        _, top = bars(means, ACCENT)
        se = sd / n ** 0.5
        curve = axes.plot(lambda x: min(1.0, (np.exp(-0.5 * ((x - mu) / se) ** 2) / (se * (2 * PI) ** 0.5)) / top * 4.4 / axes.y_length), x_range=[lo, hi, (hi - lo) / 300], color=INK, stroke_width=4)
        eq = Eq(r"\bar{X} \approx N\!\left(\mu,\ \frac{\sigma^2}{n}\right)", INK, 40).to_corner(UR, buff=0.4)
        eq.add_background_rectangle(color=BG, opacity=0.9, buff=0.12)
        self.beat(3, Create(curve), Write(eq))
`
}

const randomWalk: AnimTemplate = {
  id: 'random-walk',
  title: 'Random walks and Brownian motion',
  area: 'stochastic',
  fits: /\b(random walks?|brownian|wiener|diffusion|martingales?|stochastic process\w*|coin flips?|gambler)\b/i,
  explore: 'random-walk',
  describe: 'Coin-flip walks (or Brownian paths) drawn over time, one then many, with the ±2√t envelope that holds most of them: spread grows like √t.',
  params: {
    kind: { kind: 'enum', default: 'walk', options: ['walk', 'brownian'], describe: 'walk: ±1 steps; brownian: tiny normal steps' },
    paths: { kind: 'int', default: 8, min: 1, max: 20, describe: 'how many paths' },
    steps: { kind: 'int', default: 200, min: 20, max: 600, describe: 'steps per path' }
  },
  beats(p) {
    return [
      p.kind === 'walk' ? 'A walk: at every tick, flip a coin. Heads, step up one; tails, step down one.' : 'Brownian motion: the zig-zag Robert Brown saw in pollen grains, explained by Einstein in 1905 as countless molecular kicks. Each tick, a tiny random step.',
      `Here is one path over ${p.steps} steps. It wanders, with no pull back to zero.`,
      `Now ${p.paths} paths at once. They fan out.`,
      'But not in a straight-edged cone. They stay inside this curve, two times root t, about ninety-five percent of the time. Four times as long takes you only twice as far.'
    ]
  },
  body: String.raw`
        rng = np.random.default_rng(5)
        K, T = int(P["paths"]), int(P["steps"])
        if P["kind"] == "walk":
            inc = rng.choice([-1.0, 1.0], size=(K, T))
        else:
            inc = rng.normal(0, 1, size=(K, T))
        paths = np.concatenate([np.zeros((K, 1)), np.cumsum(inc, axis=1)], axis=1)
        top = max(2.2 * T ** 0.5, float(np.abs(paths).max())) * 1.05
        step = max(1, round(T / 5, -1) if T >= 50 else 5)
        axes = Axes(x_range=[0, T, step], y_range=[-top, top, max(1, round(top / 3))], x_length=11, y_length=5.8, axis_config={"color": MUTED, "include_tip": False}).shift(DOWN * 0.2)
        tl = Words("time", 24, MUTED).next_to(axes.x_axis, DOWN, buff=0.15).to_edge(RIGHT, buff=0.6)
        self.beat(0, Create(axes), FadeIn(tl))
        colors = [C1, C2, C3, ACCENT, MUTED]
        def line(k):
            pts = [axes.c2p(t, paths[k, t]) for t in range(T + 1)]
            m = VMobject(color=colors[k % len(colors)] if k else C1, stroke_width=3 if k == 0 else 2, stroke_opacity=1 if k == 0 else 0.75)
            m.set_points_as_corners(pts)
            return m
        first = line(0)
        self.beat(1, Create(first), run_time=2.5)
        others = [line(k) for k in range(1, K)]
        if others:
            self.beat(2, *[Create(o) for o in others], run_time=2.5)
        else:
            self.beat(2)
        up = axes.plot(lambda t: 2 * t ** 0.5, x_range=[0, T, T / 200], color=ACCENT, stroke_width=4)
        dn = axes.plot(lambda t: -2 * t ** 0.5, x_range=[0, T, T / 200], color=ACCENT, stroke_width=4)
        eq = Eq(r"\pm 2\sqrt{t}", ACCENT, 40).next_to(axes.c2p(T, 2 * T ** 0.5), UL, buff=0.1)
        self.beat(3, Create(up), Create(dn), Write(eq))
`
}

const compoundValue = (P: number, r: number, t: number, m: number) => P * Math.pow(1 + r / m, m * t)

const compounding: AnimTemplate = {
  id: 'compounding',
  title: 'Compounding, and how e appeared',
  area: 'functions',
  fits: /\b(compound\w*|interest|exponential growth|\be\b|euler'?s number|continuous(ly)? compound\w*|bernoulli|present value|discount\w*|annuit\w*|time value of money)\b/i,
  describe: 'Jacob Bernoulli\'s question (1683): the same yearly rate paid once, twice, monthly, daily; a bar for each final amount, creeping up toward the continuous limit P·e^{rt}, drawn as a line.',
  params: {
    principal: { kind: 'number', default: 1, min: 0.01, max: 1e6, describe: 'what is put in' },
    rate: { kind: 'number', default: 1, min: 0.001, max: 2, describe: 'the yearly rate (1 = 100%)' },
    years: { kind: 'number', default: 1, min: 0.25, max: 50, describe: 'how long' },
    freqs: { kind: 'numbers', default: [1, 2, 4, 12, 365], min: 1, max: 100000, maxItems: 6, describe: 'payments per year, each a bar' }
  },
  beats(p) {
    const f = p.freqs as number[]
    const v = (m: number) => fmt(compoundValue(p.principal, p.rate, p.years, m), 4)
    const cont = fmt(p.principal * Math.exp(p.rate * p.years), 4)
    return [
      `In 1683 Jacob Bernoulli asked: ${fmt(p.principal)} at ${fmt(p.rate * 100)} percent a year, for ${fmt(p.years)} year${p.years === 1 ? '' : 's'}. Paid ${f[0] === 1 ? 'once a year' : `${f[0]} times a year`}, you end with ${v(f[0])}.`,
      f.length > 1 ? `Paid ${f[1]} times a year, each payment earns interest on the ones before it: ${v(f[1])}.` : 'Interest that earns interest: that is compounding.',
      `More often still: ${f.slice(2).map((m) => `${m} times, ${v(m)}`).join('; ') || 'the gains keep coming'}. Each step gains less than the last.`,
      `The amounts close in on a limit: ${cont}, the principal times e to the rate times the time. The number e, about 2.718, first appeared exactly here.`
    ]
  },
  body: String.raw`
        P0, r, T = float(P["principal"]), float(P["rate"]), float(P["years"])
        freqs = [int(m) for m in P["freqs"]]
        vals = [P0 * (1 + r / m) ** (m * T) for m in freqs]
        cont = P0 * np.exp(r * T)
        hi = cont * 1.12
        lo = min(P0, min(vals)) * 0.85
        axes = Axes(x_range=[0, len(freqs) + 0.5, 1], y_range=[lo, hi, (hi - lo) / 4], x_length=10, y_length=5.4, axis_config={"color": MUTED, "include_tip": False}, x_axis_config={"include_ticks": False}).shift(DOWN * 0.3 + RIGHT * 0.3)
        names = {1: "yearly", 2: "twice", 4: "quarterly", 12: "monthly", 52: "weekly", 365: "daily"}
        bars = VGroup()
        labels = VGroup()
        for i, (m, v) in enumerate(zip(freqs, vals)):
            base = axes.c2p(i + 1, lo)
            topp = axes.c2p(i + 1, v)
            b = Rectangle(width=1.0, height=max(0.02, topp[1] - base[1]), stroke_width=0, fill_color=C1, fill_opacity=0.85).move_to(base, aligned_edge=DOWN)
            bars.add(b)
            labels.add(VGroup(Words("%.4g" % v, 24, INK).next_to(b, UP, buff=0.08), Words(names.get(m, f"{m}×"), 22, MUTED).next_to(base, DOWN, buff=0.15)))
        def show(i):
            return [GrowFromEdge(bars[i], DOWN), FadeIn(labels[i])]
        self.beat(0, Create(axes), *show(0))
        if len(freqs) > 1:
            self.beat(1, *show(1))
        else:
            self.beat(1)
        rest = [a for i in range(2, len(freqs)) for a in show(i)]
        if rest:
            self.beat(2, LaggedStart(*rest, lag_ratio=0.25))
        else:
            self.beat(2)
        lim = DashedLine(axes.c2p(0.4, cont), axes.c2p(len(freqs) + 0.5, cont), color=ACCENT, stroke_width=4)
        eq = Eq(r"P e^{rt} = %.4f" % cont if r * T != 1 or P0 != 1 else r"e = 2.71828\ldots", ACCENT, 38).next_to(lim, UP, buff=0.15, aligned_edge=RIGHT)
        eq.add_background_rectangle(color=BG, opacity=0.9, buff=0.1)
        self.beat(3, Create(lim), Write(eq))
`
}

export const TEMPLATES: AnimTemplate[] = [placeValue, linearMap, eigen, secant, riemann, gradient, backprop, attention, fourier, clt, randomWalk, compounding]

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? null

/** Python text for a JSON value, safe inside a raw triple-quoted string */
const pyJson = (v: unknown) => `json.loads(${JSON.stringify(JSON.stringify(v))})`

export interface BuiltScene {
  template: string
  title: string
  params: Params
  code: string
  beats: string[]
}

/**
 * A template filled in: the settings checked against their ranges (missing ones take their
 * defaults), the scene's Python, and the narration. Narration given by the tutor replaces the
 * template's line for line where it has as many lines; otherwise the template's own is used.
 */
export function buildTemplate(id: string, raw: Record<string, unknown> = {}, narration?: string[]): { ok: true; scene: BuiltScene } | { ok: false; why: string } {
  const t = templateById(id)
  if (!t) return { ok: false, why: `There is no template "${id}". Templates: ${TEMPLATES.map((x) => x.id).join(', ')}.` }
  const params: Params = {}
  const problems: string[] = []
  for (const [name, spec] of Object.entries(t.params)) {
    const given = raw[name]
    if (given === undefined || given === null) {
      params[name] = spec.default
      continue
    }
    const r = readParam(name, spec, given)
    if (r.ok) params[name] = r.value
    else problems.push(r.why)
  }
  const unknown = Object.keys(raw).filter((k) => !(k in t.params))
  if (unknown.length) problems.push(`not settings of ${id}: ${unknown.join(', ')}`)
  if (!problems.length && t.check) {
    const why = t.check(params)
    if (why) problems.push(why)
  }
  if (problems.length) return { ok: false, why: problems.join('; ') }
  // Formulas are stored as Python; the defaults are written for people
  for (const [name, spec] of Object.entries(t.params)) if ((spec.kind === 'formula' || spec.kind === 'formula2') && params[name] === spec.default) params[name] = pyFormula(String(spec.default))
  const own = t.beats(params)
  const said = Array.isArray(narration) && narration.length === own.length && narration.every((s) => typeof s === 'string' && s.trim()) ? narration.map((s) => s.trim().slice(0, 400)) : own
  const code = `from tide_manim import *\nimport json\nimport numpy as np\n${t.body.includes('fx(') ? SAFE_FN : ''}\nP = ${pyJson(params)}\n\n\nclass TideAnim(TideScene):\n    def construct(self):${t.body.replace(/\s+$/, '')}\n`
  return { ok: true, scene: { template: id, title: t.title, params, code, beats: said } }
}

/** The templates that fit a topic, best first (for prep and for the tutor's list) */
export function templatesFor(topic: string): AnimTemplate[] {
  return TEMPLATES.filter((t) => t.fits.test(topic))
}

/** One line per template, with its settings, for a prompt */
export function templateGuide(only?: AnimTemplate[]): string {
  return (only ?? TEMPLATES)
    .map((t) => `  - ${t.id}: ${t.describe} Settings: ${Object.entries(t.params).map(([k, s]) => `${k} (${s.describe}; default ${JSON.stringify(s.default)})`).join(', ')}.${t.explore ? ` Then hand over to the ${t.explore} explorable.` : ''}`)
    .join('\n')
}
