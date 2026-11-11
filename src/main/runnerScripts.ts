/**
 * The Python that the runner puts beside a learner's program: the practice web server for lessons
 * on HTTP and async code, its helper module, and the runner for a code question's hidden tests.
 * Standard library only, so they work before any library is installed.
 */

/**
 * A small web server on this Mac for one run, so real requests can be made without the internet:
 * slow answers, failures, streams and echoes, each set by the query. It listens on a free port of
 * 127.0.0.1, prints the port, and ends when Tide closes its input.
 */
export const TEACH_SERVER = `import json, os, random, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

lock = threading.Lock()
served = [0]
in_flight = {}
attempts = {}
ROUTES = {
    "/json?delay=1&id=7": "JSON after a delay in seconds (5 at most). max=3 answers 429 when more than 3 such requests are in flight",
    "/flaky?rate=0.3": "fails with 503 that share of the time. fail=2 fails the first 2 requests for the same key= instead, then succeeds",
    "/stream?n=5&delay=0.2": "n lines of JSON, one every delay seconds, as a chunked response",
    "/echo": "any method: the method, path, query, headers and body you sent",
    "/status/404": "answers with that status code",
}

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def reply(self, code, obj, headers=()):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def handle_one(self):
        url = urlparse(self.path)
        q = {k: v[-1] for k, v in parse_qs(url.query).items()}
        def num(key, default, top):
            try:
                return min(max(float(q.get(key, default)), 0), top)
            except ValueError:
                return default
        size = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(size).decode("utf-8", "replace") if size else ""
        parts = [p for p in url.path.split("/") if p]
        route = parts[0] if parts else ""
        delay = num("delay", 0, 5)
        with lock:
            served[0] += 1
            n = served[0]
        ident = q.get("id")
        if route == "":
            self.reply(200, {"endpoints": ROUTES})
        elif route in ("json", "delay", "slow"):
            cap = int(num("max", 0, 1000))
            with lock:
                now = in_flight.get(url.path, 0) + 1
                admitted = not cap or now <= cap
                if admitted:
                    in_flight[url.path] = now
            if not admitted:
                self.reply(429, {"error": "too many requests at once", "in_flight": now - 1, "max": cap}, [("Retry-After", "1")])
            else:
                try:
                    time.sleep(delay)
                    self.reply(200, {"id": ident, "delay": delay, "request": n, "in_flight": now})
                finally:
                    with lock:
                        in_flight[url.path] -= 1
        elif route == "flaky":
            time.sleep(delay)
            if "fail" in q:
                key = q.get("key", ident or "")
                with lock:
                    attempts[key] = attempts.get(key, 0) + 1
                    tried = attempts[key]
                bad = tried <= int(num("fail", 0, 100))
            else:
                tried = None
                bad = random.random() < num("rate", 0.5, 1)
            if bad:
                self.reply(503, {"error": "try again", "id": ident, "attempt": tried})
            else:
                self.reply(200, {"ok": True, "id": ident, "attempt": tried})
        elif route == "status":
            try:
                code = int(parts[1])
            except (IndexError, ValueError):
                code = 400
            code = code if 200 <= code <= 599 else 400
            if code in (204, 304):
                self.send_response(code)
                self.send_header("Content-Length", "0")
                self.end_headers()
            else:
                self.reply(code, {"status": code})
        elif route == "stream":
            count = int(num("n", 5, 1000))
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for i in range(count):
                line = (json.dumps({"i": i, "of": count}) + "\\n").encode()
                self.wfile.write(b"%x\\r\\n%s\\r\\n" % (len(line), line))
                self.wfile.flush()
                if i < count - 1:
                    time.sleep(delay)
            self.wfile.write(b"0\\r\\n\\r\\n")
        elif route == "echo":
            try:
                parsed = json.loads(body) if body else None
            except ValueError:
                parsed = None
            self.reply(200, {"method": self.command, "path": url.path, "query": q, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body, "json": parsed})
        else:
            self.reply(404, {"error": "no such endpoint", "endpoints": ROUTES})

    def do_GET(self):
        try:
            self.handle_one()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    do_POST = do_PUT = do_PATCH = do_DELETE = do_GET

class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 256

server = Server(("127.0.0.1", 0), Handler)
print("PORT %d" % server.server_address[1], flush=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
sys.stdin.read()
os._exit(0)
`

/** \`from tide_http import BASE, url\` in a lesson's Python */
export const TIDE_HTTP_HELPER = `import os
BASE = os.environ.get("TIDE_HTTP", "")
def url(path="/", **query):
    from urllib.parse import urlencode
    return BASE + (path if path.startswith("/") else "/" + path) + ("?" + urlencode(query) if query else "")
`

/**
 * Runs a code question's hidden tests against the learner's answer (answer.py, beside
 * test_answer.py) and writes which passed and failed to the file named in TIDE_TEST_RESULT. With
 * pytest installed (the lab pack) it runs them, fixtures and parametrize included; without, plain
 * test_ functions with asserts still run.
 */
export const TEST_RUNNER = `import contextlib, inspect, io, json, os, sys, traceback
sys.path.insert(0, os.getcwd())
out = {"results": [], "error": ""}

def done(code):
    with open(os.environ["TIDE_TEST_RESULT"], "w") as f:
        json.dump(out, f)
    sys.exit(code)

def brief(text, n=6):
    lines = [l for l in str(text).strip().splitlines() if l.strip()]
    return "\\n".join(lines[-n:])

try:
    import answer
except SystemExit:
    out["error"] = "Your code called exit() before the tests could run."
    done(1)
except BaseException as e:
    out["error"] = "Your code stopped with an error before the tests could run."
    tb = e.__traceback__
    traceback.print_exception(type(e), e, tb.tb_next if tb else None)
    done(1)

try:
    import pytest
except ImportError:
    pytest = None

if pytest is not None:
    class Collect:
        def pytest_runtest_logreport(self, report):
            if report.when == "call" or (report.when == "setup" and report.outcome == "failed"):
                message = ""
                if report.outcome == "failed":
                    text = report.longreprtext
                    marked = [l[1:].strip() for l in text.splitlines() if l.startswith("E ")]
                    message = "\\n".join(marked[:4]) or brief(text, 3)
                out["results"].append({"name": report.nodeid.split("::", 1)[-1], "outcome": report.outcome, "message": message})
        def pytest_collectreport(self, report):
            if report.failed:
                out["error"] = "The tests could not be loaded.\\n" + brief(report.longreprtext)
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        code = pytest.main(["-q", "-p", "no:cacheprovider", "--tb=short", "test_answer.py"], plugins=[Collect()])
    done(0 if code == 0 else 1)

try:
    import test_answer
except BaseException as e:
    out["error"] = "The tests could not be loaded.\\n" + brief("".join(traceback.format_exception_only(type(e), e)))
    done(1)

failed = False
for name, fn in list(vars(test_answer).items()):
    if not name.startswith("test_") or not inspect.isfunction(fn):
        continue
    if inspect.signature(fn).parameters:
        out["results"].append({"name": name, "outcome": "failed", "message": "This test needs pytest, which is in Tide's lab pack (Settings, Tools)."})
        failed = True
        continue
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            fn()
        out["results"].append({"name": name, "outcome": "passed", "message": ""})
    except Exception as e:
        failed = True
        frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename.endswith("test_answer.py")]
        line = frames[-1].line if frames else ""
        said = str(e)
        message = (line or "assert failed") if isinstance(e, AssertionError) and not said else "%s: %s" % (type(e).__name__, said) if said else type(e).__name__
        out["results"].append({"name": name, "outcome": "failed", "message": message})
done(1 if failed else 0)
`
