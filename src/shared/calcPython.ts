/**
 * The calculator's SymPy worker: one Python process kept running in Tide's sandbox (main/calculator)
 * so an exact answer comes back in milliseconds once SymPy has loaded. It reads one JSON request a
 * line and writes one JSON reply a line. The SymPy it runs is made by shared/calc (toSympy) from
 * what the learner typed, never by a model.
 *
 * Requests:
 *   {"id", "op": "eval", "parts": [...], "ops": [...]}   a value, an equation to solve, or a truth
 *   {"id", "op": "chain", "lines": [{"parts", "ops"}]}   each step of a working against the last
 * A check that runs past its few seconds is "unknown", never "wrong": a false mismatch would
 * overturn a correct mark.
 */
export const CALC_WORKER = String.raw`
import sys, json, signal, random
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

def ev(code):
    v = eval(code, NS)
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

def undefined(e):
    if isinstance(e, MatrixBase): return False
    return bool(e.atoms(AppliedUndef))

def same(a, b):
    """True, False or None (can't tell): two values equal"""
    a, b = done(a), done(b)
    if isinstance(a, MatrixBase) or isinstance(b, MatrixBase):
        if not (isinstance(a, MatrixBase) and isinstance(b, MatrixBase)): return None
        if a.shape != b.shape: return False
        return (a - b).applyfunc(simplify).is_zero_matrix
    if undefined(a) or undefined(b) or unevaluated(a) or unevaluated(b): return None
    d = simplify(a - b)
    if d == 0: return True
    t = a.equals(b)
    if t is True: return True
    if t is False:
        # Confirmed at random points before it's called wrong
        syms = list(free(a) | free(b))
        misses = 0
        for _ in range(4):
            sub = {s: Rational(random.randint(-90, 90), random.randint(7, 19)) for s in syms}
            try:
                x, y = complex(N(a.subs(sub))), complex(N(b.subs(sub)))
            except Exception:
                continue
            if abs(x - y) > 1e-8 * max(1, abs(x), abs(y)): misses += 1
        return False if misses >= 2 else None
    return None

def same_eq(l1, r1, l2, r2):
    l1, r1, l2, r2 = done(l1), done(r1), done(l2), done(r2)
    if any(undefined(x) or unevaluated(x) for x in (l1, r1, l2, r2)): return None
    syms = free(l1) | free(r1) | free(l2) | free(r2)
    if not syms:
        return None
    if len(syms) == 1:
        s = list(syms)[0]
        try:
            A = set(simplify(v) for v in solve(Eq(l1, r1), s))
            B = set(simplify(v) for v in solve(Eq(l2, r2), s))
        except Exception:
            return None
        inB = all(any(simplify(x - y) == 0 for y in B) for x in A)
        if inB and len(A) == len(B): return True
        # Squaring both sides gains roots: a step that follows from the last is never called wrong
        return None if inB else False
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

def chain(lines):
    out = []
    prev = None
    for ln in lines:
        parts, ops = ln.get("parts") or [], ln.get("ops") or []
        verdicts = []
        try:
            vals = [ev(p) if p is not None else None for p in parts]
        except Exception as e:
            out.append({"status": "unknown", "why": "couldn't read this line"})
            prev = None
            continue
        # Within the line: each = joins equal values
        for i, op in enumerate(ops):
            a, b = vals[i], vals[i + 1]
            if op != "=" or a is None or b is None: continue
            r = check(same, a, b)
            # x + 3 = 7 is an equation to solve, not a claim that the sides are the same: only numbers,
            # and the later links of a chain (= a = b), are held to it
            if r is False and i == 0 and (free(a) or free(b)): r = None
            if r is not None: verdicts.append((r, "the two sides of an = aren't equal" if r is False else ""))
        # Against the line before
        if prev is not None:
            pparts, pops = prev
            if parts and parts[0] is None and len(vals) > 1:
                r = check(same, pparts[-1], vals[1])
                if r is not None: verdicts.append((r, "it isn't equal to the line before" if r is False else ""))
            elif len(ops) == 1 and ops[0] == "=" and len(pops) == 1 and pops[0] == "=" and pparts[0] is not None:
                r = check(same_eq, pparts[0], pparts[1], vals[0], vals[1])
                if r is not None: verdicts.append((r, "this equation doesn't have the same solutions as the one before" if r is False else ""))
            elif not ops and not pops:
                r = check(same, pparts[0], vals[0])
                if r is not None: verdicts.append((r, "it isn't equal to the line before" if r is False else ""))
        bad = [w for ok, w in verdicts if ok is False]
        if bad: out.append({"status": "bad", "why": bad[0]})
        elif verdicts: out.append({"status": "ok", "why": ""})
        else: out.append({"status": "unknown", "why": ""})
        # What the next line carries on from: this line's values, the start filled from the line before
        filled = list(vals)
        if filled and filled[0] is None and prev is not None: filled[0] = prev[0][-1]
        prev = (filled, ops) if all(v is not None for v in filled) else None
    return out

for line in sys.stdin:
    try:
        req = json.loads(line)
    except Exception:
        continue
    rid = req.get("id")
    try:
        if req.get("op") == "chain":
            res = {"id": rid, "ok": True, "steps": chain(req.get("lines") or [])}
        else:
            res = {"id": rid, "ok": True, **evaluate(req.get("parts") or [], req.get("ops") or [])}
    except Exception as e:
        res = {"id": rid, "ok": False, "error": (type(e).__name__ + ": " + str(e))[:300]}
    print(json.dumps(res), flush=True)
`
