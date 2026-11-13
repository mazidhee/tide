"""
tide_nb: Tide's helpers inside a notebook's kernel.

    import tide_nb as tn
    tn.yield_curve(tf.treasury_yields())          # an interactive curve, scrub through the dates
    tn.option(spot=100, strike=105, t=1, r=0.03, sigma=0.2)   # payoff and Greeks with sliders
    tn.frontier(mu, cov, names)                    # the efficient frontier, hover for weights
    tn.order_book(bids, asks)                      # depth, and what a market order walks through

The pictures are drawn by Tide in its own colours and move with sliders; outside Tide they show
as a short text summary. Tide also uses this module for the variable list, checked exercises
and the chart style (Matplotlib follows Tide's theme).
"""
from __future__ import annotations

import json
import math
import sys
import types

MIME = "application/vnd.tide.finance+json"

# On Python versions where OSQP can't be built, cvxpy warns on every solve that it fell back to
# Clarabel; the answer is the same, so the warning is noise in a lesson
import warnings as _warnings

_warnings.filterwarnings("ignore", message="The default solvers are not available")


def _display(kind: str, payload: dict, text: str):
    from IPython.display import display

    display({MIME: {"kind": kind, **payload}, "text/plain": text}, raw=True)


def _num(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- the chart style


def theme(colors: dict):
    """Matplotlib in Tide's colours: transparent, ink text, quiet grid, the series colours in order."""
    ink = colors.get("ink", "#222")
    muted = colors.get("muted", "#777")
    line = colors.get("line", "#ccc")
    series = colors.get("series") or ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#7b61ff"]
    rc = {
        "figure.facecolor": "none",
        "axes.facecolor": "none",
        "savefig.facecolor": "none",
        "savefig.transparent": True,
        "figure.figsize": (7.0, 3.6),
        "figure.dpi": 96,
        "font.size": 9.5,
        "text.color": ink,
        "axes.labelcolor": ink,
        "axes.titlecolor": ink,
        "axes.edgecolor": line,
        "axes.linewidth": 0.8,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": True,
        "grid.color": line,
        "grid.linewidth": 0.6,
        "grid.alpha": 0.6,
        "xtick.color": muted,
        "ytick.color": muted,
        "xtick.labelcolor": muted,
        "ytick.labelcolor": muted,
        "legend.frameon": False,
        "lines.linewidth": 1.6,
        # A string, so it can pass through %config before Matplotlib is loaded
        "axes.prop_cycle": "cycler('color', %r)" % (list(series),),
    }
    ip = _ip()
    if ip is not None:
        try:
            ip.run_line_magic("config", "InlineBackend.figure_formats = ['retina']")
            ip.run_line_magic("config", f"InlineBackend.rc = {rc!r}")
        except Exception:
            pass
    mpl = sys.modules.get("matplotlib")
    if mpl is not None:
        mpl.rcParams.update(rc)


def _ip():
    try:
        return get_ipython()  # type: ignore[name-defined]  # noqa: F821
    except NameError:
        try:
            from IPython import get_ipython as g

            return g()
        except Exception:
            return None


# ---------------------------------------------------------------- variables

_HIDDEN = {"In", "Out", "exit", "quit", "get_ipython", "open"}


def _short(v, n=80):
    try:
        r = repr(v)
    except Exception:
        r = "<unprintable>"
    r = " ".join(r.split())
    return r if len(r) <= n else r[: n - 1] + "…"


def variables(limit=200):
    """The notebook's variables as JSON lines for Tide's inspector."""
    ip = _ip()
    ns = ip.user_ns if ip is not None else {}
    out = []
    for name, v in list(ns.items()):
        if name.startswith("_") or name in _HIDDEN:
            continue
        if isinstance(v, types.ModuleType):
            continue
        tname = type(v).__name__
        mod = type(v).__module__
        if mod not in ("builtins", "__main__"):
            tname = f"{mod.split('.')[0]}.{tname}"
        item = {"name": name, "type": tname}
        shape = getattr(v, "shape", None)
        if isinstance(shape, tuple) and all(isinstance(s, int) for s in shape):
            item["shape"] = list(shape)
        dtype = getattr(v, "dtype", None)
        if dtype is not None and not callable(dtype):
            item["dtype"] = str(dtype)
        elif hasattr(v, "dtypes") and hasattr(v, "columns"):
            try:
                item["columns"] = [str(c) for c in list(v.columns)[:12]]
            except Exception:
                pass
        if isinstance(v, (list, tuple, dict, set, str, bytes)):
            item["len"] = len(v)
        if callable(v) and not hasattr(v, "shape"):
            item["kind"] = "function" if isinstance(v, (types.FunctionType, types.BuiltinFunctionType)) else "class" if isinstance(v, type) else "callable"
            try:
                import inspect

                item["value"] = name + str(inspect.signature(v))[:80]
            except Exception:
                item["value"] = name + "(…)"
        else:
            item["value"] = _short(v)
        out.append(item)
        if len(out) >= limit:
            break
    print(json.dumps(out))


# ---------------------------------------------------------------- checked exercises


def check(tests_json: str):
    """Runs hidden tests against the notebook's variables, in a copy of its namespace."""
    ip = _ip()
    ns = dict(ip.user_ns) if ip is not None else {}
    results = []
    for t in json.loads(tests_json):
        try:
            exec(compile(t["code"], f"<test {t.get('name', '')}>", "exec"), ns)
            results.append({"name": t.get("name", ""), "ok": True})
        except AssertionError as e:
            results.append({"name": t.get("name", ""), "ok": False, "message": str(e) or "An assertion failed."})
        except Exception as e:  # noqa: BLE001
            results.append({"name": t.get("name", ""), "ok": False, "message": f"{type(e).__name__}: {e}"})
    print(json.dumps(results))


# ---------------------------------------------------------------- finance visuals


def yield_curve(data, tenors=None, title="Yield curve", max_dates=400):
    """
    An interactive yield curve. `data` is a DataFrame of dated curves (Tide's treasury_yields():
    a date column, then y_1m … y_30y), a dict {tenor_years: yield}, or a list of yields with
    `tenors` in years. With many dates, a slider scrubs through them.
    """
    curves = []
    if hasattr(data, "columns"):
        df = data
        cols = [c for c in df.columns if str(c).startswith("y_")]
        ten = [_tenor_years(c) for c in cols]
        if "date" in df.columns:
            dates = [str(d)[:10] for d in df["date"]]
        else:
            dates = [str(d)[:10] for d in df.index]
        rows = df[cols].values.tolist()
        step = max(1, len(rows) // max_dates)
        idx = list(range(0, len(rows), step))
        if idx and idx[-1] != len(rows) - 1:
            idx.append(len(rows) - 1)
        curves = [{"label": dates[i], "y": [_num(v) for v in rows[i]]} for i in idx]
        tenors = ten
    elif isinstance(data, dict):
        tenors = [float(k) for k in data.keys()]
        curves = [{"label": "curve", "y": [_num(v) for v in data.values()]}]
    else:
        curves = [{"label": "curve", "y": [_num(v) for v in data]}]
        tenors = [float(t) for t in (tenors or range(1, len(curves[0]["y"]) + 1))]
    last = curves[-1] if curves else {"label": "", "y": []}
    text = f"{title}: {last['label']} " + ", ".join(f"{t:g}y {y}" for t, y in zip(tenors, last["y"]))
    _display("yield-curve", {"title": title, "tenors": tenors, "curves": curves}, text)


def _tenor_years(col: str) -> float:
    s = str(col)[2:]
    n = float("".join(ch for ch in s if ch.isdigit() or ch == ".") or 0)
    return n / 12 if s.endswith("m") else n


def option(spot=100.0, strike=100.0, t=1.0, r=0.03, sigma=0.2, kind="call", q=0.0, legs=None, title=None):
    """
    An option's payoff at expiry and value today, with sliders for spot, volatility, time and
    rate, and the Greeks. `legs` makes a strategy: [{"kind": "call", "strike": 100, "qty": 1}, …].
    Prices are Black–Scholes, the same as tide_finance.black_scholes.
    """
    if legs is None:
        legs = [{"kind": kind, "strike": float(strike), "qty": 1}]
    legs = [{"kind": l.get("kind", "call"), "strike": float(l["strike"]), "qty": float(l.get("qty", 1))} for l in legs]
    name = title or (f"European {legs[0]['kind']}, strike {legs[0]['strike']:g}" if len(legs) == 1 else "Option strategy")
    _display("option", {"title": name, "spot": float(spot), "t": float(t), "r": float(r), "sigma": float(sigma), "q": float(q), "legs": legs}, f"{name}: spot {spot}, vol {sigma}, {t} years, rate {r}")


def frontier(mu, cov, names=None, points=60, allow_short=False, rf=None, title="Efficient frontier"):
    """
    The efficient frontier of assets with expected returns `mu` and covariance `cov` (annual),
    solved with cvxpy when it's installed (long-only by default), else in closed form (shorting
    allowed). Hover a point to see its weights.
    """
    import numpy as np

    mu = np.asarray(mu, dtype=float).ravel()
    cov = np.asarray(cov, dtype=float)
    n = len(mu)
    names = [str(x) for x in (names if names is not None else [f"Asset {i + 1}" for i in range(n)])]
    pts = []
    targets = np.linspace(mu.min(), mu.max(), points) if not allow_short else np.linspace(mu.min() - 0.5 * np.ptp(mu), mu.max() + 0.5 * np.ptp(mu), points)
    try:
        import cvxpy as cp

        w = cp.Variable(n)
        target = cp.Parameter()
        cons = [cp.sum(w) == 1, mu @ w == target] + ([] if allow_short else [w >= 0])
        prob = cp.Problem(cp.Minimize(cp.quad_form(w, cp.psd_wrap(cov))), cons)
        for tr in targets:
            target.value = float(tr)
            try:
                prob.solve()
            except Exception:
                continue
            if w.value is None:
                continue
            wv = np.clip(w.value, -10, 10)
            pts.append({"ret": float(mu @ wv), "vol": float(math.sqrt(max(wv @ cov @ wv, 0))), "w": [round(float(x), 4) for x in wv]})
        method = "cvxpy" + ("" if allow_short else ", long only")
    except ImportError:
        inv = np.linalg.pinv(cov)
        one = np.ones(n)
        a, b, c = one @ inv @ one, one @ inv @ mu, mu @ inv @ mu
        d = a * c - b * b
        for tr in targets:
            wv = inv @ ((c - b * tr) / d * one + (a * tr - b) / d * mu)
            pts.append({"ret": float(tr), "vol": float(math.sqrt(max(wv @ cov @ wv, 0))), "w": [round(float(x), 4) for x in wv]})
        method = "closed form, shorting allowed"
    assets = [{"name": names[i], "ret": float(mu[i]), "vol": float(math.sqrt(cov[i, i]))} for i in range(n)]
    best = None
    if rf is not None and pts:
        best = max(range(len(pts)), key=lambda i: (pts[i]["ret"] - rf) / pts[i]["vol"] if pts[i]["vol"] > 0 else -1e9)
    mv = min(range(len(pts)), key=lambda i: pts[i]["vol"]) if pts else None
    _display("frontier", {"title": title, "names": names, "points": pts, "assets": assets, "rf": rf, "tangency": best, "minVar": mv, "method": method}, f"{title}: {len(pts)} portfolios ({method})")


def order_book(bids, asks, title="Order book"):
    """
    Market depth from price levels: bids and asks as [(price, size), …] or DataFrames with
    price and size columns. A slider sends a market order through the book to show its cost.
    """

    def levels(x):
        if hasattr(x, "columns"):
            return [(float(p), float(s)) for p, s in zip(x["price"], x["size"])]
        return [(float(p), float(s)) for p, s in x]

    b = sorted(levels(bids), key=lambda l: -l[0])
    a = sorted(levels(asks), key=lambda l: l[0])
    text = f"{title}: best bid {b[0][0] if b else '-'}, best ask {a[0][0] if a else '-'}"
    _display("order-book", {"title": title, "bids": b, "asks": a}, text)


def graph(spec: dict):
    """A Tide graph (the same ```graph blocks lessons draw: plane, scatter, histogram, line, bar, transform, surface, space)."""
    _display_graph(spec)


def _display_graph(spec):
    from IPython.display import display

    display({"application/vnd.tide.graph+json": spec, "text/plain": f"Graph: {spec.get('title', spec.get('kind', ''))}"}, raw=True)
