/**
 * The calculator's SymPy worker: one Python process kept running in Tide's sandbox (main/calculator)
 * so an exact answer comes back in milliseconds once SymPy has loaded. It reads one JSON request a
 * line and writes one JSON reply a line. The SymPy it runs is made by shared/calc (toSympy) from
 * what the learner typed, never by a model.
 *
 * Requests:
 *   {"id", "op": "eval", "parts": [...], "ops": [...]}   a value, an equation to solve, or a truth
 *   {"id", "op": "chain", "lines": [{"parts", "ops"}], "log10"?}   each step of a working against the
 *       last: ok, bad or unknown, and whether it was proved equal to the line before ("follows")
 * A step is "bad" only when that is certain. A check that runs past its few seconds, or a gap that
 * rounding, a domain, a branch, a case or a value put in could explain, is "unknown", never
 * "wrong": a false mismatch would overturn a correct mark.
 */
export const CALC_WORKER = String.raw`
import sys, json, signal, random
import re as _re  # sympy's * brings its own re (the real part)
try:
    from sympy import *
    from sympy.core.function import AppliedUndef
    from sympy.matrices import MatrixBase
    print(json.dumps({"ready": True}), flush=True)
except Exception as e:
    print(json.dumps({"ready": False, "error": "SymPy isn't installed: " + str(e)}), flush=True)
    sys.exit(0)

class _Slow(Exception):
    pass

def _alarm(*a):
    raise _Slow()

signal.signal(signal.SIGALRM, _alarm)

def _rad(a): return a*pi/180
def _deg(a): return a*180/pi
def _root(a, n):
    if getattr(n, "is_Integer", False) and int(n) % 2 == 1 and getattr(a, "is_negative", False):
        return -root(-a, n)
    return root(a, n)
def _det(m): return m.det() if isinstance(m, MatrixBase) else m
def _transpose(m): return m.T if isinstance(m, MatrixBase) else m
def _times(a, b):
    if isinstance(a, MatrixBase) and isinstance(b, MatrixBase) and a.shape == (3, 1) and b.shape == (3, 1):
        return a.cross(b)
    return a * b

NS = {}
exec("from sympy import *", NS)
NS.update({"_rad": _rad, "_deg": _deg, "_root": _root, "_det": _det, "_transpose": _transpose, "_times": _times})

# The same names with an unmarked log read as base 10 (main/calculator tries it before calling a step wrong)
NS_LOG10 = dict(NS)
NS_LOG10["log"] = lambda a, b=None: log(a, 10 if b is None else b)

def ev(code, ns=None):
    v = eval(code, ns or NS)
    return v if isinstance(v, MatrixBase) else sympify(v)

def done(e):
    if isinstance(e, MatrixBase):
        return e.applyfunc(lambda x: simplify(x.doit()))
    try:
        return e.doit()
    except Exception:
        return e

def unevaluated(e):
    if isinstance(e, MatrixBase):
        return any(unevaluated(x) for x in e)
    return bool(getattr(e, "has", lambda *a: False)(Integral, Limit, Sum, Product, Derivative))

def free(e):
    return set() if isinstance(e, MatrixBase) and not e.free_symbols else e.free_symbols

def numeric(e):
    try:
        if isinstance(e, MatrixBase):
            if e.free_symbols: return None
            return latex(e.evalf(12))
        if e.free_symbols: return None
        n = N(e, 15)
        if n.has(Integral, Limit): return None
        return str(n) if n.is_real or n.is_real is None else latex(n)
    except Exception:
        return None

def pretty(e):
    return latex(e)

def evaluate(parts, ops):
    if not ops:
        given = ev(parts[0])
        r = done(given)
        if not isinstance(r, MatrixBase) and not unevaluated(r):
            try:
                r = simplify(r)
            except Exception:
                pass
        approx = unevaluated(r)
        # Nothing to simplify (1/3 + sqrt(2)): the exact answer is what was typed, so only the decimal says anything
        try:
            unchanged = (not isinstance(r, MatrixBase)) and r == given and not r.is_Number
        except Exception:
            unchanged = False
        return {"kind": "value", "exact": None if approx else pretty(r), "numeric": numeric(r), "text": str(r), "unchanged": bool(unchanged)}
    if len(ops) == 1 and ops[0] == "=" and parts[0] is not None:
        l, r = done(ev(parts[0])), done(ev(parts[1]))
        syms = sorted(free(l) | free(r), key=lambda s: (s.name != "x", s.name))
        if syms:
            s = syms[0]
            sols = solve(Eq(l, r), s)
            if not sols:
                return {"kind": "solve", "exact": "\\text{no solution for } " + latex(s), "numeric": None, "text": "[]"}
            exact = ",\\quad ".join(latex(s) + " = " + latex(simplify(v)) for v in sols)
            # Decimals only when a solution isn't a plain fraction (x = 2 needs no "x ≈ 2.000")
            def short(v):
                t = str(N(v, 12))
                return t.rstrip("0").rstrip(".") if "." in t and "e" not in t else t
            plain = all(getattr(simplify(v), "is_Rational", False) for v in sols)
            num = None if plain or any(simplify(v).free_symbols for v in sols) else ",\\quad ".join(latex(s) + " \\approx " + short(v) for v in sols)
            return {"kind": "solve", "exact": exact, "numeric": num, "text": str(sols)}
    vals = [done(ev(p)) for p in parts if p is not None]
    rels = {"=": Eq, "<": Lt, ">": Gt, "<=": Le, ">=": Ge, "!=": Ne}
    truth = True
    for i, op in enumerate([o for o in ops if o != "~"][: len(vals) - 1]):
        t = rels.get(op, Eq)(vals[i], vals[i + 1])
        if t is not true and t is not True:
            truth = bool(simplify(t)) if t in (true, false) else (False if t is false else None)
            if truth is not True: break
    return {"kind": "truth", "exact": "\\text{true}" if truth else ("\\text{false}" if truth is False else "\\text{can't tell}"), "numeric": None, "text": str(truth)}

# ---------- steps ----------
# A step is called wrong only when that is certain: anything rounding, a domain, a branch, a case
# or a substitution could explain is "can't tell". Missing a slip costs less than a false cross.

DECIMAL = _re.compile(r'Rational\("-?\d*\.(\d+)"\)')
WRITTEN = _re.compile(r'^\(?-?(?:Integer\(\d+\)|Rational\("\d*\.?(\d*)"\))\)?$')

def places(code):
    """The fewest decimal places of a decimal written in this part, or None when it has none"""
    ps = [len(m.group(1)) for m in DECIMAL.finditer(code or "")]
    return min(ps) if ps else None

def written(code):
    """A part that is just a number as written (5, -0.667): its decimal places, else None"""
    m = WRITTEN.match((code or "").replace(" ", ""))
    return None if not m else len(m.group(1) or "")

def undefined(e):
    if isinstance(e, MatrixBase): return False
    return bool(e.atoms(AppliedUndef))

def close(x, y):
    return abs(x - y) <= Float("1e-9", 30) * Max(1, abs(x), abs(y))

def numbers_differ(a, b, ca, cb):
    """Two numbers simplify couldn't show equal: False only when rounding can't explain the gap"""
    x, y = N(a, 30), N(b, 30)
    if not (x.is_number and y.is_number and x.is_finite and y.is_finite): return None
    gap = abs(x - y)
    if close(x, y): return None
    # 2/3 = 0.667, 2/3 = 0.66 and 2000/3 = 667: the written number is the other one rounded or cut
    # short, to one unit in its last place; 1/2 = 0.6 is wrong (0.5 needs no rounding)
    for code, other in ((ca, b), (cb, a)):
        p = written(code)
        if p is None: continue
        if (other * Integer(10) ** p).is_Integer: continue
        if gap <= Rational(1, 10 ** p) * (1 + Rational(1, 10 ** 9)): return None
    # Decimals inside the working (0.33 + 0.33 + 0.33 = 1): rounded earlier, so close is not wrong
    ps = [p for p in (places(ca), places(cb)) if p is not None]
    if ps and gap <= Rational(1, 10 ** min(ps)) * Max(1, abs(x), abs(y)): return None
    return False

def differs_at_points(a, b, syms):
    """Two expressions shown different where they are real: at positive points (so no log, root or
    branch question arises), never agreeing anywhere tried, and different at a whole number too
    (sin(n pi) = 0 holds for every whole n)"""
    rng = random.Random(7)
    points = []
    for _ in range(2): points.append(({s: Rational(rng.randint(1, 9), rng.randint(10, 19)) for s in syms}, False))
    for _ in range(3): points.append(({s: Rational(rng.randint(20, 90), rng.randint(7, 11)) for s in syms}, False))
    for _ in range(3): points.append(({s: Integer(rng.randint(2, 7)) for s in syms}, True))
    real, whole_differs = 0, False
    for sub, whole in points:
        try:
            x, y = N(a.subs(sub), 30), N(b.subs(sub), 30)
        except Exception:
            continue
        if not (x.is_real and y.is_real and x.is_finite and y.is_finite): continue
        real += 1
        if close(x, y): return None
        if whole: whole_differs = True
    return False if real >= 4 and whole_differs else None

def same(a, b, ca="", cb=""):
    """True, False or None (can't tell): two values equal. ca and cb are the parts as written"""
    a, b = done(a), done(b)
    if isinstance(a, MatrixBase) or isinstance(b, MatrixBase):
        if not (isinstance(a, MatrixBase) and isinstance(b, MatrixBase)): return None
        if a.shape != b.shape:
            # A row for a column: written another way, not wrong
            if a.shape == b.T.shape: return None
            return False
        z = (a - b).applyfunc(simplify).is_zero_matrix
        if z: return True
        return False if z is False and not (free(a) or free(b)) and places(ca) is None and places(cb) is None else None
    if undefined(a) or undefined(b) or unevaluated(a) or unevaluated(b): return None
    if simplify(a - b) == 0: return True
    if a.equals(b) is True: return True
    # Not the same letters: a value put in (3x^2 - 4, then 3(2)^2 - 4), a constant of integration
    # (x^2 + C), units: not a claim that the two are the same
    if free(a) != free(b): return None
    if not free(a): return numbers_differ(a, b, ca, cb)
    if places(ca) is not None or places(cb) is not None: return None
    return differs_at_points(a, b, sorted(free(a), key=str))

def solved(l, r):
    """x = 3: a lone letter on one side, a number on the other"""
    return (l.is_Symbol and not free(r)) or (r.is_Symbol and not free(l))

def real_roots(l, r, s):
    """The real solutions SymPy finds, or None when it can't say which are real"""
    out = []
    for v in solve(Eq(l, r), s):
        if isinstance(v, dict): return None
        v = simplify(v)
        if free(v) or v.is_real is None: return None
        if v.is_real and not any(simplify(v - w) == 0 for w in out): out.append(v)
    return out

def holds(l, r, s, v):
    """True, False or None: the equation is true at s = v"""
    try:
        x, y = N(l.subs(s, v), 30), N(r.subs(s, v), 30)
    except Exception:
        return None
    if not (x.is_number and y.is_number and x.is_finite and y.is_finite): return None
    return bool(close(x, y))

def same_eq(l1, r1, l2, r2, c1="", c2="", earlier=()):
    l1, r1, l2, r2 = done(l1), done(r1), done(l2), done(r2)
    if any(undefined(x) or unevaluated(x) or isinstance(x, MatrixBase) for x in (l1, r1, l2, r2)): return None
    syms = free(l1) | free(r1) | free(l2) | free(r2)
    if not syms:
        return None
    if len(syms) == 1:
        s = list(syms)[0]
        if not (free(l1) | free(r1)) or not (free(l2) | free(r2)): return None
        A, B = real_roots(l1, r1, s), real_roots(l2, r2, s)
        if A is None or B is None or not A or not B: return None
        if len(A) == len(B) and all(any(simplify(x - y) == 0 for y in B) for x in A): return True
        # Wrong only when the two share no solution either way. Squaring gains roots, a domain
        # (x > 0, 0 ≤ x < π) loses them and SymPy lists one turn of a periodic answer, so any
        # overlap is "can't tell"; so are decimals (x = 1.41 for √2) and cases side by side
        # (x = 3, then x = 5), and a solution that answers an earlier line
        if places(c1) is not None or places(c2) is not None: return None
        if solved(l1, r1) and solved(l2, r2): return None
        if any(holds(l2, r2, s, a) is not False for a in A): return None
        if any(holds(l1, r1, s, b) is not False for b in B): return None
        for le, re_ in earlier:
            if free(le) | free(re_) == {s} and any(holds(le, re_, s, b) is not False for b in B): return None
        return False
    e1, e2 = l1 - r1, l2 - r2
    if e2 == 0: return None
    k = simplify(e1 / e2)
    return True if (k.is_constant() and k != 0) else None

def check(f, *a):
    signal.alarm(4)
    try:
        return f(*a)
    except _Slow:
        return None
    except Exception:
        return None
    finally:
        signal.alarm(0)

def chain(lines, ns=None):
    out = []
    prev = None
    earlier = []
    for ln in lines:
        parts, ops = ln.get("parts") or [], ln.get("ops") or []
        verdicts = []
        follows = False
        try:
            vals = [ev(p, ns) if p is not None else None for p in parts]
        except Exception as e:
            out.append({"status": "unknown", "why": "couldn't read this line", "follows": False})
            prev = None
            continue
        # Within the line: each = joins equal values
        for i, op in enumerate(ops):
            a, b = vals[i], vals[i + 1]
            if op != "=" or a is None or b is None: continue
            r = check(same, a, b, parts[i], parts[i + 1])
            # x + 3 = 7 is an equation to solve, not a claim that the sides are the same: only numbers,
            # and the later links of a chain (= a = b), are held to it
            if r is False and i == 0 and (free(a) or free(b)): r = None
            if r is not None: verdicts.append((r, "the two sides of an = aren't equal" if r is False else ""))
        # Against the line before: only a line that starts "=" carries on from it (≈ and ≤ don't claim equal)
        if prev is not None:
            pvals, pops, pcodes = prev
            link = None
            if parts and parts[0] is None and len(vals) > 1:
                if ops[0] == "=":
                    link = check(same, pvals[-1], vals[1], pcodes[-1], parts[1])
                    why = "it isn't equal to the line before"
            elif len(ops) == 1 and ops[0] == "=" and len(pops) == 1 and pops[0] == "=" and pvals[0] is not None:
                link = check(same_eq, pvals[0], pvals[1], vals[0], vals[1], " ".join(pcodes), " ".join(parts), list(earlier[:-1]))
                why = "this equation doesn't have the same solutions as the one before"
            elif not ops and not pops:
                link = check(same, pvals[0], vals[0], pcodes[0], parts[0])
                why = "it isn't equal to the line before"
            if link is not None: verdicts.append((link, why if link is False else ""))
            follows = link is True
        bad = [w for ok, w in verdicts if ok is False]
        if bad: out.append({"status": "bad", "why": bad[0], "follows": False})
        elif verdicts: out.append({"status": "ok", "why": "", "follows": follows})
        else: out.append({"status": "unknown", "why": "", "follows": False})
        # What the next line carries on from: this line's values, the start filled from the line before
        filled, codes = list(vals), list(parts)
        if filled and filled[0] is None and prev is not None:
            filled[0], codes[0] = prev[0][-1], prev[2][-1]
        prev = (filled, ops, codes) if all(v is not None for v in filled) else None
        if prev and len(ops) == 1 and ops[0] == "=":
            # Under the same time limit as a check: an integral SymPy can't finish mustn't hold up the rest
            sides = check(lambda: (done(filled[0]), done(filled[1])))
            if sides: earlier.append(sides)
    return out

for line in sys.stdin:
    try:
        req = json.loads(line)
    except Exception:
        continue
    rid = req.get("id")
    try:
        if req.get("op") == "chain":
            # log10: the same working read with an unmarked log as base 10, the way a school writes it
            res = {"id": rid, "ok": True, "steps": chain(req.get("lines") or [], NS_LOG10 if req.get("log10") else None)}
        else:
            res = {"id": rid, "ok": True, **evaluate(req.get("parts") or [], req.get("ops") or [])}
    except Exception as e:
        res = {"id": rid, "ok": False, "error": (type(e).__name__ + ": " + str(e))[:300]}
    print(json.dumps(res), flush=True)
`
