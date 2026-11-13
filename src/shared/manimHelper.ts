/**
 * tide_manim.py: the module every maths animation imports (shared/manim). It gives a scene
 * Tide's colours (the theme the lesson is shown in, never Manim's blue on black), beats that are
 * as long as their narration, equations that fall back to plain text when LaTeX isn't installed,
 * and a log of when each beat started, which becomes the captions. Written next to the scene in
 * the render's sandbox folder; nothing here touches the network or any file but the beat log.
 */
export const TIDE_MANIM_PY = String.raw`import json, os, re
from contextlib import contextmanager
from manim import *

_T = json.loads(os.environ.get("TIDE_THEME") or "{}")
DARK = _T.get("scheme") == "dark"
BG = _T.get("bg") or ("#17181c" if DARK else "#fbfaf7")
INK = _T.get("ink") or ("#e9e7e2" if DARK else "#1f1e1c")
MUTED = _T.get("muted") or ("#9a978f" if DARK else "#77736b")
LINE = _T.get("line") or ("#3a3b40" if DARK else "#dedad2")
ACCENT = _T.get("accent") or "#d4622a"
C1 = _T.get("c1") or "#3d7dd8"
C2 = _T.get("c2") or "#2f9e74"
C3 = _T.get("c3") or "#b5651d"
POS = _T.get("pos") or C2
NEG = _T.get("neg") or "#c84a4a"
HAS_TEX = os.environ.get("TIDE_TEX") == "1"
FONT = "Helvetica Neue"

try:
    _BEATS = json.load(open(os.environ["TIDE_BEATS"])) if os.environ.get("TIDE_BEATS") else []
except Exception:
    _BEATS = []

# Manim draws white by default, which vanishes on a light page: the theme's ink instead
for _cls in (Text, MarkupText, Line, Arrow, Vector, DashedLine, Dot, Circle, Square, Rectangle, Polygon, Arc, Brace, NumberLine, DecimalNumber, Integer, SurroundingRectangle, VMobject):
    try:
        _cls.set_default(color=INK)
    except Exception:
        pass
for _cls in (MathTex, Tex):
    try:
        _cls.set_default(color=INK)
    except Exception:
        pass

_SYMBOLS = {
    r"\to": "→", r"\rightarrow": "→", r"\infty": "∞", r"\cdot": "·", r"\times": "×", r"\leq": "≤", r"\le": "≤",
    r"\geq": "≥", r"\ge": "≥", r"\neq": "≠", r"\approx": "≈", r"\pm": "±", r"\sum": "Σ", r"\int": "∫", r"\prod": "Π",
    r"\partial": "∂", r"\nabla": "∇", r"\lim": "lim", r"\sqrt": "√", r"\lambda": "λ", r"\mu": "μ", r"\sigma": "σ",
    r"\alpha": "α", r"\beta": "β", r"\theta": "θ", r"\pi": "π", r"\Delta": "Δ", r"\delta": "δ", r"\epsilon": "ε",
    r"\eta": "η", r"\omega": "ω", r"\phi": "φ", r"\in": "∈", r"\log": "log", r"\ln": "ln", r"\sin": "sin", r"\cos": "cos",
    r"\exp": "exp", r"\max": "max", r"\min": "min", r"\quad": "  ", r"\,": " ", r"\;": " ", r"\!": "",
}
_SUP = str.maketrans("0123456789+-=()nixt", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱˣᵗ")
_SUB = str.maketrans("0123456789+-=()nixt", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₙᵢₓₜ")

def tex_to_text(s):
    """LaTeX as readable plain text, for when LaTeX isn't installed"""
    t = s.replace(r"\tfrac", r"\frac").replace(r"\dfrac", r"\frac").replace(r"\ldots", "…").replace(r"\cdots", "⋯")
    t = t.replace(r"\hat{\imath}", "î").replace(r"\hat{\jmath}", "ĵ")
    t = re.sub(r"\\(?:vec|mathbf|boldsymbol)\{(\w)\}", r"\1", t)
    t = re.sub(r"\\hat\{(\w)\}", "\\1\u0302", t)
    t = re.sub(r"\\bar\{(\w)\}", "\\1\u0304", t)
    for _ in range(4):
        t = re.sub(r"\\frac\{([^{}]*)\}\{([^{}]*)\}", lambda m: "(" + m.group(1) + ")/(" + m.group(2) + ")", t)
        t = re.sub(r"\\sqrt\{([^{}]*)\}", lambda m: "√(" + m.group(1) + ")", t)
        t = re.sub(r"\\(?:text|mathrm|mathbf|operatorname|mathit|boldsymbol)\{([^{}]*)\}", r"\1", t)
    t = re.sub(r"\\left|\\right", "", t)
    for k in sorted(_SYMBOLS, key=len, reverse=True):
        t = t.replace(k, _SYMBOLS[k])
    t = re.sub(r"\^\{([^{}]*)\}", lambda m: m.group(1).translate(_SUP) if all(c in "0123456789+-=()nixt" for c in m.group(1)) else "^(" + m.group(1) + ")", t)
    t = re.sub(r"\^([0-9nixt])", lambda m: m.group(1).translate(_SUP), t)
    t = re.sub(r"_\{([^{}]*)\}", lambda m: m.group(1).translate(_SUB) if all(c in "0123456789+-=()nixt" for c in m.group(1)) else "_" + m.group(1), t)
    t = re.sub(r"_([0-9nixt])", lambda m: m.group(1).translate(_SUB), t)
    t = t.replace("{", "").replace("}", "").replace("\\", "")
    return re.sub(r"\s+", " ", t).strip()

def Eq(tex, color=None, size=44):
    """An equation: typeset when LaTeX is installed, else the same maths as plain text"""
    if HAS_TEX:
        return MathTex(tex, color=color or INK, font_size=size)
    return Text(tex_to_text(tex), font=FONT, color=color or INK, font_size=size * 0.78)

def Words(s, size=30, color=None, weight=NORMAL):
    return Text(s, font=FONT, font_size=size, color=color or INK, weight=weight)

class Readout(VGroup):
    """A number that can change (set_value, .animate.set_value), drawn as text so it needs no LaTeX"""

    def __init__(self, value=0.0, places=2, size=30, color=None, **kw):
        super().__init__(**kw)
        self.places, self.size, self.tint, self.value = places, size, color or INK, float(value)
        self.add(self._make(self.value))

    def _make(self, v):
        return Text(("%." + str(self.places) + "f") % v, font=FONT, font_size=self.size, color=self.tint)

    def set_value(self, v):
        self.value = float(v)
        new = self._make(self.value)
        new.move_to(self[0].get_left(), aligned_edge=LEFT)
        self[0].become(new)
        return self

    def get_value(self):
        return self.value

def Num(x, places=2, size=30, color=None):
    return Readout(x, places, size, color)

def Integer(x, font_size=30, color=None, **kw):
    return Readout(x, 0, font_size, color)

def beat_count():
    return len(_BEATS)

class TideScene(Scene):
    """A scene in Tide's colours whose beats last as long as their narration"""

    def setup(self):
        self.camera.background_color = BG
        self._tide_log = []

    def _say(self, i):
        return _BEATS[i] if 0 <= i < len(_BEATS) else {"dur": 2.0}

    @contextmanager
    def during(self, i):
        """Everything played inside lasts at least as long as beat i's narration"""
        info = self._say(i)
        start = self.renderer.time
        if info.get("wav"):
            self.add_sound(info["wav"])
        yield info
        rest = float(info.get("dur", 2.0)) + 0.35 - (self.renderer.time - start)
        if rest > 0.05:
            self.wait(rest)
        self._tide_log.append({"i": i, "start": round(start, 3), "end": round(self.renderer.time, 3)})
        print("TIDE_BEAT %d/%d" % (len(self._tide_log), max(len(_BEATS), len(self._tide_log))), flush=True)

    def beat(self, i, *anims, run_time=None, **kw):
        """Plays these together for beat i, then holds until its narration has finished"""
        info = self._say(i)
        with self.during(i):
            if anims:
                rt = run_time or min(max(1.0, float(info.get("dur", 2.0)) * 0.6), 3.0)
                self.play(*anims, run_time=rt, **kw)

    def tear_down(self):
        out = os.environ.get("TIDE_BEAT_LOG")
        if out:
            with open(out, "w") as f:
                json.dump(self._tide_log, f)
`
