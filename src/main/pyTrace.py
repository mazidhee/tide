"""Tide's Python tracer: runs a short snippet under sys.settrace and writes what memory held at
each step, for a visual to replay (TideMachine.python, main/pyTrace). Standard library only.

    python -I pyTrace.py snippet.py trace.json [ops]

Each step is the state just before a line runs (or as a function returns): the frames, innermost
last, each with its names and the id of the object each names; and the objects reachable from
them, by id: type, value, items, attributes, CPython's int digits, size. Objects are kept once
per distinct state, so a long trace stays small.

With "ops" (the Python lab, renderer lib/pyLab) a step is taken before each bytecode instruction
instead of each line: every code object that runs is disassembled once into "codes", and each
frame says which code it runs and the offset of the instruction it is about to run.
"""
import dis
import io
import json
import sys

OPS = len(sys.argv) > 3 and sys.argv[3] == "ops"
MAX_STEPS = 2000 if OPS else 240
MAX_OBJECTS = 80
MAX_ITEMS = 24
MAX_TEXT = 60
MAX_OUT = 4000

src_path, out_path = sys.argv[1], sys.argv[2]
with open(src_path, encoding="utf-8") as f:
    SOURCE = f.read()

FILE = "<snippet>"
ATOMS = (int, float, complex, bool, str, bytes, type(None))
HIDDEN = {"__builtins__", "__name__", "__doc__", "__package__", "__loader__", "__spec__", "__annotations__", "__file__", "__cached__", "__annotate__", "__conditional_annotations__"}


def text(v):
    r = repr(v)
    return r if len(r) <= MAX_TEXT else r[: MAX_TEXT - 1] + "…"


def ref(o):
    return "0x%x" % id(o)


def int_digits(v):
    """CPython stores an int's magnitude in base 2**30 digits, least significant first"""
    v = abs(v)
    if v == 0:
        return [0]
    out = []
    while v:
        out.append(v & (2**30 - 1))
        v >>= 30
    return out


def snapshot(o, todo):
    t = type(o).__name__
    s = {"t": t}
    try:
        s["sz"] = sys.getsizeof(o)
    except Exception:
        pass
    if isinstance(o, bool) or o is None:
        s["v"] = repr(o)
    elif isinstance(o, int):
        s["v"] = str(o) if len(str(o)) <= MAX_TEXT else text(o)
        s["d"] = int_digits(o)[:8]
        s["neg"] = o < 0
    elif isinstance(o, ATOMS):
        s["v"] = text(o)
    elif isinstance(o, (list, tuple, set, frozenset)):
        items = list(o)
        s["items"] = [ref(x) for x in items[:MAX_ITEMS]]
        if len(items) > MAX_ITEMS:
            s["more"] = len(items) - MAX_ITEMS
        if isinstance(o, list):
            # Slots CPython has allocated (over-allocation on append), from the list's size
            s["cap"] = max(len(o), (sys.getsizeof(o) - sys.getsizeof([])) // 8)
        todo.extend(items[:MAX_ITEMS])
    elif isinstance(o, dict):
        pairs = list(o.items())[:MAX_ITEMS]
        s["items"] = [[ref(k), ref(v)] for k, v in pairs]
        if len(o) > MAX_ITEMS:
            s["more"] = len(o) - MAX_ITEMS
        for k, v in pairs:
            todo.append(k)
            todo.append(v)
    elif callable(o) and hasattr(o, "__code__"):
        s["t"] = "function"
        s["v"] = o.__name__
    elif isinstance(o, type):
        s["t"] = "class"
        s["v"] = o.__name__
    else:
        attrs = getattr(o, "__dict__", None)
        if isinstance(attrs, dict):
            pairs = [(k, v) for k, v in attrs.items() if not k.startswith("__")][:MAX_ITEMS]
            s["attrs"] = [[k, ref(v)] for k, v in pairs]
            todo.extend(v for _, v in pairs)
        else:
            s["v"] = text(o)
    return s


steps = []
kept = {}
objects = []
out = io.StringIO()
real_out = sys.stdout
stopped = [None]


class Stop(Exception):
    pass


def frames_of(frame):
    chain = []
    f = frame
    while f is not None and f.f_code.co_filename == FILE:
        chain.append(f)
        f = f.f_back
    return list(reversed(chain))


def names_of(f):
    try:
        loc = dict(f.f_locals)
    except Exception:
        loc = {}
    return [(k, v) for k, v in loc.items() if k not in HIDDEN and not (k.startswith("__") and k.endswith("__")) and type(v).__name__ != "module"]


codes = []
code_index = {}


def code_of(c):
    """The index of a code object in "codes", disassembling it the first time it runs"""
    i = code_index.get(id(c))
    if i is None:
        ops = []
        for ins in dis.get_instructions(c):
            if hasattr(ins.argval, "co_code"):
                arg = "code " + ins.argval.co_name
            else:
                arg = ins.argrepr or ("" if ins.arg is None else str(ins.arg))
            line = ins.positions.lineno if ins.positions and ins.positions.lineno else 0
            ops.append([ins.offset, ins.opname, arg[:MAX_TEXT], line, 1 if ins.is_jump_target else 0])
        i = code_index[id(c)] = len(codes)
        codes.append({"name": "module" if c.co_name == "<module>" else c.co_name, "first": c.co_firstlineno, "ops": ops})
        keep_alive.append(c)
    return i


# Code objects disassembled, so their ids are not reused while the trace runs
keep_alive = []
# Each frame's last line: an instruction the compiler added (an except block's clean-up) has none
last_line = {}


def line_of(f):
    n = f.f_lineno
    if n:
        last_line[id(f)] = n
        return n
    return last_line.get(id(f), f.f_code.co_firstlineno)


def record(frame, event, arg):
    chain = frames_of(frame)
    shown = []
    todo = []
    for f in chain:
        names = names_of(f)
        fr = {"name": "module" if f.f_code.co_name == "<module>" else f.f_code.co_name, "line": line_of(f), "names": [[k, ref(v)] for k, v in names]}
        if OPS:
            fr["code"] = code_of(f.f_code)
            fr["at"] = f.f_lasti
        shown.append(fr)
        todo.extend(v for _, v in names)
    step = {"line": line_of(frame), "event": event, "frames": shown}
    if event == "return" and frame.f_code.co_name != "<module>":
        step["ret"] = ref(arg)
        todo.append(arg)
    if event == "exception":
        step["exc"] = "%s: %s" % (arg[0].__name__, text(str(arg[1])))
    heap = []
    seen = set()
    while todo and len(seen) < MAX_OBJECTS:
        o = todo.pop(0)
        if id(o) in seen:
            continue
        seen.add(id(o))
        snap = snapshot(o, todo)
        key = ref(o) + json.dumps(snap, sort_keys=True)
        if key not in kept:
            kept[key] = len(objects)
            snap["id"] = ref(o)
            objects.append(snap)
        heap.append(kept[key])
    step["heap"] = heap
    printed = out.getvalue()
    step["out"] = printed[-MAX_OUT:]
    steps.append(step)
    if len(steps) >= MAX_STEPS:
        stopped[0] = "Stopped after %d steps" % MAX_STEPS
        raise Stop()


def tracer(frame, event, arg):
    if frame.f_code.co_filename != FILE:
        return None
    if OPS:
        frame.f_trace_opcodes = True
        if event in ("opcode", "return", "exception"):
            record(frame, event, arg)
    elif event in ("line", "return", "exception"):
        record(frame, event, arg)
    return tracer


result = {"code": SOURCE}
g = {"__name__": "__main__"}
try:
    code = compile(SOURCE, FILE, "exec")
    sys.stdout = out
    sys.settrace(tracer)
    try:
        exec(code, g)
    finally:
        sys.settrace(None)
        sys.stdout = real_out
    result["ok"] = True
except Stop:
    sys.settrace(None)
    sys.stdout = real_out
    result["ok"] = True
except SyntaxError as e:
    result["ok"] = False
    result["error"] = "SyntaxError: %s (line %s)" % (e.msg, e.lineno)
except BaseException as e:
    sys.settrace(None)
    sys.stdout = real_out
    result["ok"] = True
    result["error"] = "%s: %s" % (type(e).__name__, text(str(e)))

if stopped[0]:
    result["stopped"] = stopped[0]
result["steps"] = steps
result["objects"] = objects
if OPS:
    result["codes"] = codes
    result["version"] = "%d.%d.%d" % sys.version_info[:3]
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, separators=(",", ":"))
