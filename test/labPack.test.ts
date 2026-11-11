import { existsSync, mkdtempSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { LAB_PACK } from '../src/shared/labPack'

/**
 * The installer's logic runs here against stand-ins. With TIDE_LAB_VENV set to a scratch Python
 * environment that has the pack (never Tide's own), the status check and PyTorch in the sandbox
 * run for real:  TIDE_LAB_VENV=/path/to/venv npx vitest run test/labPack.test.ts
 */
const venv = process.env.TIDE_LAB_VENV ?? ''
const dir = mkdtempSync(join(tmpdir(), 'tide-lab-'))
if (venv) symlinkSync(venv, join(dir, 'python'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false } }))
const { installLab, labStatus, labStatusOf, pipFailure, pipProgress, runCode, setupLab } = await import('../src/main/runner')

const READY = { ready: true, detail: 'PyTorch 2.15.0' }
const NOT_YET = { ready: false, detail: 'Not installed yet' }

function standIn(o: { statuses: { ready: boolean; detail: string }[]; python?: boolean; free?: number | null; pip?: { code: number; err: string }; load?: { code: number; err: string }; lines?: string[] }) {
  const calls: string[] = []
  const statuses = [...o.statuses]
  return {
    calls,
    python: '/env/bin/python',
    dir: '/env',
    exists: () => o.python ?? true,
    run: async (cmd: string, args: string[], onLine?: (l: string) => void) => {
      calls.push([cmd, ...args].join(' '))
      if (args[0] === '-c') return o.load ?? { code: 0, err: '' }
      if (args[0] === '-m' && args[1] === 'pip') {
        for (const l of o.lines ?? []) onLine?.(l)
        return o.pip ?? { code: 0, err: '' }
      }
      return { code: 0, err: '' }
    },
    status: async () => statuses.shift() ?? NOT_YET,
    freeBytes: async () => (o.free === undefined ? 50e9 : o.free)
  }
}

describe('installing the lab pack', () => {
  it('asks pip, in Tide’s own Python, for exactly the pack', async () => {
    const d = standIn({ statuses: [NOT_YET, READY] })
    expect(await installLab(d)).toEqual(READY)
    expect(d.calls).toEqual(['/env/bin/python -m pip install --disable-pip-version-check --progress-bar off torch scikit-learn scipy pytest tqdm requests httpx aiohttp', '/env/bin/python -c import torch, sklearn, scipy, pytest, tqdm, requests, httpx, aiohttp'])
    expect(LAB_PACK.packages.length).toBe(LAB_PACK.modules.length)
  })

  it('does nothing when it is already there', async () => {
    const d = standIn({ statuses: [READY] })
    expect(await installLab(d)).toEqual(READY)
    expect(d.calls).toEqual([])
  })

  it('creates the environment first when Tide has none yet', async () => {
    const d = standIn({ statuses: [NOT_YET, READY], python: false })
    await installLab(d)
    expect(d.calls[0]).toBe('/usr/bin/env python3 -m venv /env')
    expect(d.calls[1]).toMatch(/^\/env\/bin\/python -m pip install/)
  })

  it('says what is happening as pip goes, starting with the size', async () => {
    const said: string[] = []
    const d = standIn({ statuses: [NOT_YET, READY], lines: ['Collecting torch', '  Downloading torch-2.15.0-cp315-cp315-macosx_14_0_arm64.whl.metadata (30 kB)', 'Downloading torch-2.15.0-cp315-cp315-macosx_14_0_arm64.whl (138.6 MB)', 'Requirement already satisfied: numpy in ./lib', 'Installing collected packages: tqdm, torch', 'Successfully installed torch-2.15.0'] })
    await installLab(d, (s) => said.push(s))
    expect(said).toEqual(['Downloading the lab pack (about 180 MB, about 900 MB on disk)…', 'Finding torch…', 'Downloading torch (138.6 MB)…', 'Installing (PyTorch takes a minute)…', 'Installed. Checking it…', 'Loading it for the first time…'])
  })

  it('stops before downloading when the disk is too full, and says how much it needs', async () => {
    const d = standIn({ statuses: [NOT_YET], free: 0.4e9 })
    const r = await installLab(d)
    expect(r).toEqual({ ready: false, detail: 'Not enough free space: the lab pack takes about 900 MB, and this Mac has 0.4 GB free.' })
    expect(d.calls).toEqual([])
  })

  it('fails cleanly: no connection, no build for this Python, a full disk, anything else', async () => {
    const offline = standIn({ statuses: [NOT_YET], pip: { code: 1, err: "WARNING: Retrying (Retry(total=0)) after connection broken by 'NewConnectionError': Failed to establish a new connection: [Errno 8] nodename nor servname provided\nERROR: Could not find a version that satisfies the requirement torch (from versions: none)\nERROR: No matching distribution found for torch\n" } })
    expect(await installLab(offline)).toEqual({ ready: false, detail: "Couldn't download the lab pack: check the internet connection and try again. What was already installed is kept." })
    expect(pipFailure('ERROR: Could not find a version that satisfies the requirement torch (from versions: none)\nERROR: No matching distribution found for torch\n')).toBe("Couldn't install the lab pack: No matching distribution found for torch. This Python may be too new or too old for one of its libraries.")
    expect(pipFailure('ERROR: Could not install packages due to an OSError: [Errno 28] No space left on device')).toContain('the disk is full')
    expect(pipFailure('ERROR: something else broke')).toBe("Couldn't install the lab pack: something else broke")
    expect(pipFailure('')).toContain('pip stopped without saying why')
  })

  it('does not call it ready when pip finished but a library still does not load', async () => {
    const d = standIn({ statuses: [NOT_YET, { ready: false, detail: 'Not finished: torch still to install' }] })
    expect(await installLab(d)).toEqual({ ready: false, detail: 'Installed, but it did not load: Not finished: torch still to install' })
  })

  it('does not call it ready when a library is installed but will not load on this Mac', async () => {
    const d = standIn({ statuses: [NOT_YET, READY], load: { code: 1, err: 'Traceback (most recent call last):\nImportError: dlopen(libtorch.dylib): Library not loaded' } })
    expect(await installLab(d)).toEqual({ ready: false, detail: 'Installed, but it did not load: ImportError: dlopen(libtorch.dylib): Library not loaded' })
  })

  it('reads which libraries are there', () => {
    expect(labStatusOf('torch 2.15.0\nscikit-learn 1.9.1\nscipy 1.18.1\npytest 9.2.0\ntqdm 4.70.1\nrequests 2.34.2\nhttpx 0.28.1\naiohttp 3.14.5\n')).toEqual({ ready: true, detail: 'PyTorch 2.15.0, scikit-learn 1.9.1, SciPy 1.18.1, pytest 9.2.0, and tqdm, requests, httpx, aiohttp' })
    expect(labStatusOf('torch -\nscikit-learn -\nscipy -\npytest -\ntqdm -\nrequests -\nhttpx -\naiohttp -\n')).toEqual({ ready: false, detail: 'Not installed yet: about 180 MB to download, about 900 MB on disk' })
    expect(labStatusOf('torch -\nscikit-learn 1.9.1\nscipy 1.18.1\npytest 9.2.0\ntqdm 4.70.1\nrequests 2.34.2\nhttpx -\naiohttp 3.14.5\n').detail).toBe('Not finished: torch, httpx still to install')
  })

  it('ignores pip lines that say nothing worth showing', () => {
    expect(pipProgress('  Using cached numpy-2.4.0.whl.metadata (6 kB)')).toBe('')
    expect(pipProgress('Collecting scikit-learn>=1.0')).toBe('Finding scikit-learn…')
    expect(pipProgress('Downloading scikit_learn-1.9.1-cp315-cp315-macosx_12_0_arm64.whl (8.3 MB)')).toBe('Downloading scikit-learn (8.3 MB)…')
  })

  it.skipIf(!!venv)('reports not set up when Tide has no Python environment', async () => {
    expect(existsSync(join(dir, 'python'))).toBe(false)
    expect(await labStatus()).toEqual({ ready: false, detail: 'Not set up yet: about 180 MB to download, about 900 MB on disk' })
  })
})

describe.skipIf(!venv)('the lab pack in a scratch environment', () => {
  it('is found, and setting it up again installs nothing', async () => {
    const s = await labStatus()
    expect(s.ready).toBe(true)
    expect(s.detail).toMatch(/^PyTorch \d+\.\d+/)
    const said: string[] = []
    expect(await setupLab((x) => said.push(x))).toEqual(s)
    expect(said).toEqual([])
  }, 60_000)

  it('runs a tensor and a 20-step training loop in the sandbox, on the CPU and on the GPU (MPS)', async () => {
    const code = `import time
t0 = time.perf_counter()
import torch
print("import %.2f s" % (time.perf_counter() - t0), "mps", torch.backends.mps.is_available())
def train(dev):
    torch.manual_seed(0)
    t = time.perf_counter()
    a = torch.tensor([[1., 2.], [3., 4.]], device=dev)
    total = (a @ a).sum().item()
    first = time.perf_counter() - t
    x = torch.randn(4096, 256, device=dev); y = x[:, :1] * 3 + 1
    m = torch.nn.Sequential(torch.nn.Linear(256, 512), torch.nn.ReLU(), torch.nn.Linear(512, 1)).to(dev)
    opt = torch.optim.Adam(m.parameters(), 1e-3)
    losses = []
    t = time.perf_counter()
    for _ in range(20):
        opt.zero_grad(); loss = torch.nn.functional.mse_loss(m(x), y); loss.backward(); opt.step(); losses.append(loss.item())
    print(dev, "sum", total, "tensor %.3f s" % first, "20 steps %.3f s" % (time.perf_counter() - t), "learning" if losses[-1] < losses[0] else "NOT learning")
train("cpu")
if torch.backends.mps.is_available():
    train("mps")
`
    const r = await runCode('python', code)
    console.log(r.stdout + r.stderr, `whole run ${r.durationMs} ms`)
    expect(r.stderr).toBe('')
    expect(r.stdout).toMatch(/cpu sum 54\.0 .* learning/)
    if (/mps True/.test(r.stdout)) expect(r.stdout).toMatch(/mps sum 54\.0 .* learning/)
    expect(r.timedOut).toBe(false)
  }, 90_000)

  it('runs scikit-learn and SciPy, and hidden tests through pytest itself', async () => {
    const r = await runCode('python', 'from sklearn.linear_model import LinearRegression\nfrom scipy import optimize\nimport numpy as np\nm = LinearRegression().fit(np.arange(10).reshape(-1, 1), np.arange(10) * 2 + 1)\nprint(round(float(m.coef_[0]), 3), round(float(optimize.brentq(lambda x: x * x - 2, 0, 2)), 4))')
    expect(r.stderr).toBe('')
    expect(r.stdout.trim()).toBe('2.0 1.4142')
    const t = await runCode('python', 'def double(x):\n    return x * 2 if x != 3 else 7\n', '', undefined, { tests: 'import pytest\n\n@pytest.mark.parametrize("n", [1, 2, 3])\ndef test_double(n):\n    assert double(n) == n * 2\n' })
    expect(t.tests!.passed).toEqual(['test_double[1]', 'test_double[2]'])
    expect(t.tests!.failed[0].name).toBe('test_double[3]')
    expect(t.tests!.failed[0].message).toMatch(/assert 7 == \(3 \* 2\)/)
  }, 90_000)

  it('makes real requests to the practice server with httpx, aiohttp and requests', async () => {
    const code = `import asyncio, time, aiohttp, httpx, requests
from tide_http import url
async def main():
    t = time.perf_counter()
    async with httpx.AsyncClient() as c:
        rs = await asyncio.gather(*(c.get(url("/json", delay=0.4, id=i)) for i in range(10)))
    print("httpx", len(rs), time.perf_counter() - t < 1.5)
    async with aiohttp.ClientSession() as s:
        async with s.get(url("/stream", n=3)) as r:
            print("aiohttp", len([l async for l in r.content]))
    print("requests", requests.get(url("/status/404")).status_code)
    try:
        requests.get("https://example.com", timeout=3)
        print("outside REACHED")
    except requests.exceptions.RequestException:
        print("outside refused")
asyncio.run(main())`
    const r = await runCode('python', code, '', 30_000)
    expect(r.stdout.trim().split('\n')).toEqual(['httpx 10 True', 'aiohttp 3', 'requests 404', 'outside refused'])
  }, 90_000)
})

/** Downloads and installs for real, into a throwaway environment: TIDE_LAB_INSTALL=1 npx vitest run test/labPack.test.ts */
describe.skipIf(!process.env.TIDE_LAB_INSTALL || !!venv)('installing the lab pack for real, into a throwaway environment', () => {
  it('creates the environment, installs, reports progress, and is ready; a second go installs nothing', async () => {
    const said: string[] = []
    const first = await setupLab((s) => said.push(s))
    console.log(said.join('\n'), '\n', first)
    expect(first.ready).toBe(true)
    expect(existsSync(join(dir, 'python', 'bin', 'python'))).toBe(true)
    expect(said[0]).toBe('Creating Tide’s Python environment…')
    expect(said).toContain('Installing (PyTorch takes a minute)…')
    const again: string[] = []
    expect(await setupLab((s) => again.push(s))).toEqual(first)
    expect(again).toEqual([])
  }, 900_000)
})
