"""Tide's run tracker: the parameters, metrics and curves of each training run, so you can compare
runs and see what changed. Standard library only; works in a notebook, a lesson and a project.

    import tide_runs

    with tide_runs.run("lr 0.1", params={"lr": 0.1, "epochs": 20, "hidden": 64}) as r:
        for epoch in range(20):
            ...
            r.log(epoch, loss=loss, val_loss=val_loss, acc=acc)
        r.summary(test_acc=test_acc)

    tide_runs.compare()          # the runs side by side: the parameters that differ, final metrics

Each run is a JSON-lines file in Tide's runs folder (TIDE_RUNS_DIR), one folder per experiment
(TIDE_RUNS_EXPERIMENT: the notebook's name, or "lessons"). The notebook's Runs tab draws them.
Tensors and NumPy numbers are logged as plain floats; a loss that blows up is kept as NaN or
Infinity, so a diverged run shows as one.
"""
import json
import math
import os
import re
import time
import uuid

__all__ = ["run", "start", "log", "log_params", "summary", "end", "runs", "compare", "Run"]

_current = None


def _dir():
    return os.environ.get("TIDE_RUNS_DIR") or os.path.join(os.getcwd(), ".tide_runs")


def _experiment(name=None):
    return name or os.environ.get("TIDE_RUNS_EXPERIMENT") or "default"


def _safe(name):
    return re.sub(r"[^\w.-]+", "-", str(name)).strip("-")[:80] or "default"


def _value(v):
    """A number as JSON can hold it: tensors and NumPy scalars become floats; NaN and infinity become text."""
    if hasattr(v, "detach"):
        v = v.detach()
    if hasattr(v, "item"):
        try:
            v = v.item()
        except Exception:
            pass
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        f = float(v)
        if math.isnan(f):
            return "NaN"
        if math.isinf(f):
            return "Infinity" if f > 0 else "-Infinity"
        return v if isinstance(v, int) else f
    if isinstance(v, (str, type(None))):
        return v
    if isinstance(v, (list, tuple)):
        return [_value(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _value(x) for k, x in v.items()}
    return str(v)


class Run:
    """One training run. Use it as a context manager, or call end() when it's done."""

    def __init__(self, name=None, params=None, experiment=None, notes=""):
        self.experiment = _experiment(experiment)
        self.id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
        self.name = str(name) if name else "run " + self.id[9:15]
        folder = os.path.join(_dir(), _safe(self.experiment))
        os.makedirs(folder, exist_ok=True)
        self.path = os.path.join(folder, self.id + ".jsonl")
        self.params = {}
        self.steps = 0
        self.ended = False
        self._write({"type": "start", "id": self.id, "name": self.name, "experiment": self.experiment, "time": time.time(), "notes": str(notes)})
        if params:
            self.log_params(params)

    def _write(self, record):
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")

    def log_params(self, params=None, **more):
        """The settings this run was trained with: learning rate, batch size, layers, seed…"""
        p = dict(params or {}, **more)
        self.params.update({str(k): _value(v) for k, v in p.items()})
        self._write({"type": "params", "params": {str(k): _value(v) for k, v in p.items()}})
        return self

    def log(self, step=None, **metrics):
        """Metrics at one step (an epoch, a batch): r.log(epoch, loss=0.31, acc=0.92)"""
        if step is None:
            step = self.steps
        self.steps = max(self.steps, int(step) + 1) if isinstance(step, (int, float)) else self.steps + 1
        self._write({"type": "metric", "step": _value(step), "values": {str(k): _value(v) for k, v in metrics.items()}, "time": time.time()})
        return self

    def summary(self, **values):
        """Final numbers that aren't a curve: test accuracy, parameter count, training time"""
        self._write({"type": "summary", "values": {str(k): _value(v) for k, v in values.items()}})
        return self

    def end(self, status="finished"):
        if not self.ended:
            self.ended = True
            self._write({"type": "end", "status": status, "time": time.time()})
        return self

    def __enter__(self):
        return self

    def __exit__(self, kind, value, tb):
        self.end("failed" if kind and kind is not KeyboardInterrupt else "stopped" if kind else "finished")
        return False

    def __repr__(self):
        return "<tide_runs.Run %r in %r, %d steps>" % (self.name, self.experiment, self.steps)


def run(name=None, params=None, experiment=None, notes=""):
    """Starts a run (ending the one before, if it is still open) and returns it"""
    global _current
    if _current is not None and not _current.ended:
        _current.end()
    _current = Run(name, params, experiment, notes)
    return _current


start = run


def _need():
    if _current is None:
        raise RuntimeError("No run started: call tide_runs.run(name, params={...}) first")
    return _current


def log(step=None, **metrics):
    return _need().log(step, **metrics)


def log_params(params=None, **more):
    return _need().log_params(params, **more)


def summary(**values):
    return _need().summary(**values)


def end(status="finished"):
    return _need().end(status)


def _read(path):
    r = {"id": os.path.basename(path)[:-6], "name": "", "params": {}, "metrics": {}, "summary": {}, "status": "running", "steps": 0}
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            t = rec.get("type")
            if t == "start":
                r["name"] = rec.get("name", r["id"])
                r["time"] = rec.get("time")
            elif t == "params":
                r["params"].update(rec.get("params", {}))
            elif t == "metric":
                for k, v in rec.get("values", {}).items():
                    r["metrics"].setdefault(k, []).append((rec.get("step"), v))
                r["steps"] += 1
            elif t == "summary":
                r["summary"].update(rec.get("values", {}))
            elif t == "end":
                r["status"] = rec.get("status", "finished")
    return r


def runs(experiment=None):
    """Every run of an experiment, oldest first, as dicts: name, params, metrics (lists of (step, value)), summary, status"""
    folder = os.path.join(_dir(), _safe(_experiment(experiment)))
    if not os.path.isdir(folder):
        return []
    return [_read(os.path.join(folder, n)) for n in sorted(os.listdir(folder)) if n.endswith(".jsonl")]


def _fmt(v):
    if isinstance(v, float):
        return "%.4g" % v
    return str(v)


def _last(series):
    for _, v in reversed(series):
        if v is not None:
            return v
    return None


def compare(*names, experiment=None, last=5):
    """Prints the runs side by side (the last few, or those named): the parameters that differ between them and each metric's final value. runs() gives the data."""
    rs = runs(experiment)
    if names:
        rs = [r for r in rs if r["name"] in names or r["id"] in names]
    else:
        rs = rs[-last:]
    if not rs:
        print("No runs yet in %r: start one with tide_runs.run(name, params={...})" % _experiment(experiment))
        return
    keys = sorted({k for r in rs for k in r["params"]})
    differ = [k for k in keys if len({json.dumps(r["params"].get(k)) for r in rs}) > 1]
    same = [k for k in keys if k not in differ]
    metrics = sorted({k for r in rs for k in r["metrics"]} | {k for r in rs for k in r["summary"]})
    rows = [["run"] + differ + ["final " + m for m in metrics]]
    for r in rs:
        row = [r["name"]] + [_fmt(r["params"].get(k, "")) for k in differ]
        for m in metrics:
            v = r["summary"].get(m, _last(r["metrics"].get(m, [])))
            row.append("" if v is None else _fmt(v))
        rows.append(row)
    widths = [max(len(str(row[i])) for row in rows) for i in range(len(rows[0]))]
    lines = ["  ".join(str(c).ljust(w) for c, w in zip(row, widths)) for row in rows]
    lines.insert(1, "  ".join("-" * w for w in widths))
    if same:
        lines.append("Same in every run: " + ", ".join("%s=%s" % (k, _fmt(rs[0]["params"][k])) for k in same))
    print("\n".join(lines))
