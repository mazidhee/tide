import { mkdtempSync } from 'fs'
import { createServer } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-runn-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false } }))
const { runCode, networkNote, profile } = await import('../src/main/runner')

const LONG = 60_000

describe('the sandbox and the network', () => {
  it('lets a program listen on this Mac and connect only to the ports it is given', () => {
    const p = profile(['/var/folders/x/tide-run-1', '/Users/me/cache'], [50123, 50456, 0, 70000])
    expect(p).toContain('(deny network*)')
    expect(p).toContain('(allow network-outbound (remote ip "localhost:50123"))\n(allow network-outbound (remote ip "localhost:50456"))')
    // All of loopback is never opened: other things listen there, and closing single ports afterwards does not hold
    expect(p).not.toContain('remote ip "localhost:*"')
    expect(p).not.toMatch(/localhost:(0|70000)"/)
    // One rule naming both ends would let any outbound connection through
    expect(p).not.toMatch(/\(allow network\*/)
    expect(p).not.toMatch(/local ip[^)]*\) \(remote ip/)
    expect(p).toContain('(subpath "/var/folders/x/tide-run-1") (subpath "/private/var/folders/x/tide-run-1") (subpath "/Users/me/cache")')
    expect(profile(['/x'])).not.toContain('network-outbound')
  })

  it('lets a program talk to a server it starts on the port it is given', async () => {
    const code = `import http.server, json, os, threading, urllib.request
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"path": self.path}).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
port = int(os.environ["TIDE_PORT"])
srv = http.server.HTTPServer(("127.0.0.1", port), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
print(urllib.request.urlopen("http://127.0.0.1:%d/hello" % port).read().decode())`
    const r = await runCode('python', code)
    expect(r.stderr).toBe('')
    expect(r.stdout.trim()).toBe('{"path": "/hello"}')
  }, LONG)

  it('refuses an address outside this Mac: by number, by name, and by UDP', async () => {
    const code = `import socket
for host in ("1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"):
    try:
        socket.create_connection((host, 80), timeout=4).close()
        print(host, "CONNECTED")
    except OSError as e:
        print(host, type(e).__name__)
try:
    socket.getaddrinfo("example.com", 80)
    print("name RESOLVED")
except OSError as e:
    print("name", type(e).__name__)
u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    u.sendto(b"x", ("1.1.1.1", 53))
    print("udp SENT")
except OSError as e:
    print("udp", type(e).__name__)`
    const r = await runCode('python', code, '', 30_000)
    expect(r.stdout).not.toMatch(/CONNECTED|RESOLVED|SENT/)
    expect(r.stdout).toContain('1.1.1.1 PermissionError')
    expect(r.stdout).toContain('93.184.216.34 PermissionError')
    expect(r.stdout).toContain('name gaierror')
    expect(r.stdout).toContain('udp PermissionError')
  }, LONG)

  it('refuses the outside from JavaScript too, while its own server answers', async () => {
    const code = `const http = require('http')
const port = Number(process.env.TIDE_PORT)
const srv = http.createServer((q, s) => s.end('pong')).listen(port, '127.0.0.1', async () => {
  console.log('loopback', await (await fetch('http://127.0.0.1:' + port)).text())
  try { await fetch('http://1.1.1.1', { signal: AbortSignal.timeout(4000) }); console.log('outside CONNECTED') } catch (e) { console.log('outside refused') }
  srv.close()
})`
    const r = await runCode('javascript', code, '', 30_000)
    expect(r.stdout).toBe('loopback pong\noutside refused\n')
  }, LONG)

  it('keeps everything else that listens on this Mac out of reach, and says what can be reached', async () => {
    // Stands in for the model server, a search engine or a database on localhost
    const mine = createServer((_q, s) => s.end('secret')).listen(0, '127.0.0.1')
    await new Promise((r) => mine.once('listening', r))
    const port = (mine.address() as { port: number }).port
    try {
      const caught = await runCode('python', `import urllib.request\ntry:\n    print(urllib.request.urlopen("http://127.0.0.1:${port}/", timeout=4).read().decode())\nexcept OSError as e:\n    print("refused", type(getattr(e, "reason", e)).__name__)`)
      expect(caught.stdout.trim()).toBe('refused PermissionError')
      const raised = await runCode('python', `import urllib.request\nprint(urllib.request.urlopen("http://localhost:${port}/", timeout=4).read().decode())`)
      expect(raised.stdout).toBe('')
      expect(raised.stderr).toContain('Operation not permitted')
      expect(raised.stderr).toContain("There is no internet in Tide's sandbox. A program can reach Tide's practice server (its address is in TIDE_HTTP) and a server it starts itself on 127.0.0.1 at the port in TIDE_PORT, and nothing else.")
      const sh = await runCode('bash', `/usr/bin/curl -s -m 4 http://127.0.0.1:${port}/ || echo refused`)
      expect(sh.stdout).toBe('refused\n')
    } finally {
      mine.close()
    }
  }, LONG)

  it('adds the note only when a connection was refused', () => {
    expect(networkNote('ZeroDivisionError: division by zero', 'import socket')).toBe('')
    expect(networkNote('PermissionError: [Errno 1] Operation not permitted', 'open("/etc/x", "w")')).toBe('')
    expect(networkNote('curl: (6) Could not resolve host: example.com', 'curl https://example.com')).toContain('no internet')
  })
})

describe('the practice server', () => {
  it('is there when the code asks for it, with its address in TIDE_HTTP', async () => {
    const r = await runCode('python', 'import json, os, urllib.request\nbase = os.environ["TIDE_HTTP"]\nprint(base.rsplit(":", 1)[0])\nprint(sorted(json.load(urllib.request.urlopen(base + "/"))["endpoints"]))')
    expect(r.stderr).toBe('')
    const [base, routes] = r.stdout.trim().split('\n')
    expect(base).toBe('http://127.0.0.1')
    expect(routes).toContain('/json?delay=1&id=7')
    expect(routes).toContain('/flaky?rate=0.3')
  }, LONG)

  it('is not started for code that does not name it', async () => {
    const r = await runCode('python', 'import os\nprint(os.environ.get("TIDE_" + "HTTP"))')
    expect(r.stdout.trim()).toBe('None')
  }, LONG)

  it('answers ten slow requests at once in the time of one: asyncio.gather really runs', async () => {
    const code = `import asyncio, json, time
from tide_http import BASE, url

async def get(path):
    host, port = BASE.removeprefix("http://").split(":")
    reader, writer = await asyncio.open_connection(host, int(port))
    writer.write(f"GET {path} HTTP/1.1\\r\\nHost: {host}\\r\\nConnection: close\\r\\n\\r\\n".encode())
    raw = await reader.read()
    writer.close()
    head, _, body = raw.partition(b"\\r\\n\\r\\n")
    return int(head.split()[1]), json.loads(body)

async def main():
    t = time.perf_counter()
    answers = await asyncio.gather(*(get(f"/json?delay=0.5&id={i}") for i in range(10)))
    took = time.perf_counter() - t
    print(sorted(int(a["id"]) for _, a in answers))
    print("concurrent" if took < 1.5 else "sequential", "slow enough" if took >= 0.5 else "too fast")
    try:
        await asyncio.wait_for(get("/json?delay=3"), timeout=0.3)
    except asyncio.TimeoutError:
        print("timed out as asked")
    statuses = [(await get("/flaky?fail=2&key=job"))[0] for _ in range(3)]
    print(statuses)
    print((await get("/flaky?rate=1"))[0], (await get("/flaky?rate=0"))[0])
    crowd = await asyncio.gather(*(get("/slow?delay=0.3&max=3") for _ in range(8)))
    print(sorted(s for s, _ in crowd))
    print(url("/echo", a=1))

asyncio.run(main())`
    const r = await runCode('python', code, '', 30_000)
    expect(r.stderr).toBe('')
    const lines = r.stdout.trim().split('\n')
    expect(lines[0]).toBe('[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]')
    expect(lines[1]).toBe('concurrent slow enough')
    expect(lines[2]).toBe('timed out as asked')
    expect(lines[3]).toBe('[503, 503, 200]')
    expect(lines[4]).toBe('503 200')
    expect(lines[5]).toBe('[200, 200, 200, 429, 429, 429, 429, 429]')
    expect(lines[6]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/echo\?a=1$/)
  }, LONG)

  it('streams line by line and echoes what it was sent', async () => {
    const code = `import json, os, time, urllib.request
base = os.environ["TIDE_HTTP"]
t = time.perf_counter()
gaps = []
with urllib.request.urlopen(base + "/stream?n=4&delay=0.2") as r:
    for line in r:
        gaps.append(round(time.perf_counter() - t, 2))
        last = json.loads(line)
print(len(gaps), last, gaps[-1] - gaps[0] >= 0.5)
req = urllib.request.Request(base + "/echo?x=1", data=json.dumps({"n": 5}).encode(), method="POST", headers={"X-Lesson": "async"})
e = json.load(urllib.request.urlopen(req))
print(e["method"], e["query"], e["json"], e["headers"]["x-lesson"])
try:
    urllib.request.urlopen(base + "/status/418")
except urllib.error.HTTPError as err:
    print(err.code)`
    const r = await runCode('python', code, '', 30_000)
    expect(r.stderr).toBe('')
    expect(r.stdout.trim().split('\n')).toEqual(["4 {'i': 3, 'of': 4} True", "POST {'x': '1'} {'n': 5} async", '418'])
  }, LONG)

  it('serves other languages too', async () => {
    const r = await runCode('javascript', "fetch(process.env.TIDE_HTTP + '/json?id=js').then((r) => r.json()).then((j) => console.log(j.id))")
    expect(r.stdout).toBe('js\n')
    const sh = await runCode('bash', '/usr/bin/curl -s "$TIDE_HTTP/status/201"')
    expect(sh.stdout).toBe('{"status": 201}')
  }, LONG)
})
