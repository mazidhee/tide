/**
 * Notebooks: .ipynb round trips, which cells are stale, output rendering, the tutor's proposals,
 * and the quant pack's installer (with a stand-in for uv and pip).
 */
import { describe, expect, it, vi } from 'vitest'
import { codeCell, markdownCell, newNotebook, notebookText, outputText, parseNotebook, serializeNotebook, splitLines } from '../src/shared/notebook/ipynb'
import { cellNames, cellStates, staleOrder, type CellRunInfo } from '../src/shared/notebook/deps'
import { ansiToHtml } from '../src/shared/notebook/ansi'
import { settleStream } from '../src/renderer/src/lib/notebook/store'
import { pickMime } from '../src/shared/notebook/mime'
import { walkBook } from '../src/renderer/src/components/notebook/FinanceVisual'
import { findUv, installArgs, installPack, packFailure, packProgress, packStatusOf, type PackInstaller } from '../src/main/notebook/pack'
import { QUANT_PACK } from '../src/shared/labPack'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/tide-nb-test' }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: () => {}, on: () => {} } }))

// ---------- .ipynb ----------

const JUPYTER_FILE = `{
 "cells": [
  {
   "cell_type": "markdown",
   "id": "intro",
   "metadata": {},
   "source": [
    "# Title\\n",
    "\\n",
    "Some $x^2$ maths."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 3,
   "id": "c1",
   "metadata": {
    "tags": [
     "keep"
    ]
   },
   "outputs": [
    {
     "name": "stdout",
     "output_type": "stream",
     "text": [
      "hi\\n"
     ]
    },
    {
     "data": {
      "image/png": "iVBORw0KGgo=",
      "text/plain": [
       "<Figure size 640x480 with 1 Axes>"
      ]
     },
     "metadata": {},
     "output_type": "display_data"
    },
    {
     "data": {
      "text/html": [
       "<table>\\n",
       "</table>"
      ],
      "text/plain": [
       "   a\\n",
       "0  1"
      ]
     },
     "execution_count": 3,
     "metadata": {},
     "output_type": "execute_result"
    },
    {
     "ename": "ValueError",
     "evalue": "bad",
     "output_type": "error",
     "traceback": [
      "\\u001b[0;31mValueError\\u001b[0m: bad"
     ]
    }
   ],
   "source": [
    "print('hi')\\n",
    "df"
   ]
  },
  {
   "attachments": {
    "a.png": {
     "image/png": "AAAA"
    }
   },
   "cell_type": "markdown",
   "id": "att",
   "metadata": {},
   "source": [
    "![a](attachment:a.png)"
   ]
  }
 ],
 "metadata": {
  "kernelspec": {
   "display_name": "Python 3",
   "language": "python",
   "name": "python3"
  },
  "language_info": {
   "name": "python",
   "version": "3.12.0"
  }
 },
 "nbformat": 4,
 "nbformat_minor": 5
}
`

describe('.ipynb files', () => {
  it('round-trips a Jupyter notebook byte for byte', () => {
    const nb = parseNotebook(JUPYTER_FILE)
    expect(nb.cells.map((c) => c.id)).toEqual(['intro', 'c1', 'att'])
    expect(nb.cells[1].source).toBe("print('hi')\ndf")
    expect(nb.cells[1].execution_count).toBe(3)
    expect(nb.cells[2].extra?.attachments).toBeTruthy()
    expect(serializeNotebook(nb)).toBe(JUPYTER_FILE)
  })

  it('keeps an edit and nothing else', () => {
    const nb = parseNotebook(JUPYTER_FILE)
    nb.cells[1].source = "print('hello')\ndf"
    const out = serializeNotebook(nb)
    expect(out).toContain(`"print('hello')\\n"`)
    expect(out.replace(`"print('hello')\\n"`, `"print('hi')\\n"`)).toBe(JUPYTER_FILE)
  })

  it('reads older notebooks without cell ids and gives each one, and refuses non-notebooks', () => {
    const nb = parseNotebook(JSON.stringify({ cells: [{ cell_type: 'code', source: 'x = 1', metadata: {}, outputs: [] }, { cell_type: 'code', source: 'y', metadata: {}, outputs: [] }], metadata: {}, nbformat: 4, nbformat_minor: 2 }))
    expect(nb.cells[0].id).toMatch(/^[a-zA-Z0-9-_]{1,64}$/)
    expect(nb.cells[0].id).not.toBe(nb.cells[1].id)
    expect(JSON.parse(serializeNotebook(nb)).nbformat_minor).toBe(5)
    expect(() => parseNotebook('not json')).toThrow(/not valid JSON/)
    expect(() => parseNotebook(JSON.stringify({ nbformat: 3, worksheets: [] }))).toThrow(/old format/)
  })

  it('makes new notebooks Jupyter can open', () => {
    const nb = newNotebook([markdownCell('# Hi'), codeCell('1 + 1')])
    const back = JSON.parse(serializeNotebook(nb))
    expect(back.metadata.kernelspec.name).toBe('python3')
    expect(back.cells[1]).toMatchObject({ cell_type: 'code', execution_count: null, outputs: [], source: ['1 + 1'] })
    expect(splitLines('a\nb\n')).toEqual(['a\n', 'b\n'])
    expect(splitLines('')).toEqual([])
  })

  it('describes the notebook for the tutor, errors and pictures included', () => {
    const nb = parseNotebook(JUPYTER_FILE)
    const t = notebookText(nb)
    expect(t).toContain('id=c1')
    expect(t).toContain('[error] ValueError: bad')
    expect(t).toContain('(a image/png picture)')
    expect(t).not.toContain('\u001b')
    expect(outputText({ output_type: 'stream', name: 'stdout', text: 'x'.repeat(3000) }, 100)).toContain('2900 more characters')
  })
})

// ---------- Stale cells ----------

describe('the names a cell defines and uses', () => {
  const n = (s: string) => {
    const r = cellNames(s)
    return { defs: r.defs.sort(), uses: r.uses.sort() }
  }
  it('reads assignments, imports, defs and loops', () => {
    expect(n('import numpy as np\nfrom math import sqrt, pi as PI\nx = np.arange(10)\ny, z = x * 2, sqrt(PI)')).toEqual({ defs: ['PI', 'np', 'sqrt', 'x', 'y', 'z'], uses: [] })
    expect(n('total = sum(prices) / n')).toEqual({ defs: ['total'], uses: ['n', 'prices'] })
    expect(n('x += step')).toEqual({ defs: ['x'], uses: ['step', 'x'] })
    expect(n('for i, v in enumerate(data):\n    acc = acc + v')).toEqual({ defs: ['acc', 'i', 'v'], uses: ['acc', 'data'] })
    expect(n('with open(path) as f:\n    text = f.read()')).toEqual({ defs: ['f', 'text'], uses: ['path'] })
    expect(n('rate: float = base * 2')).toEqual({ defs: ['rate'], uses: ['base'] })
  })

  it('keeps function and comprehension names local', () => {
    expect(n('def price(s, k=strike):\n    d = s - k\n    return d * scale\n')).toEqual({ defs: ['price'], uses: ['scale', 'strike'] })
    expect(n('sq = [v * v for v in values if v > cutoff]')).toEqual({ defs: ['sq'], uses: ['cutoff', 'values'] })
    expect(n('f = lambda t: t * growth')).toEqual({ defs: ['f'], uses: ['growth'] })
    expect(n('class Model(Base):\n    rate = 1\n    def fit(self):\n        return self.rate * k')).toEqual({ defs: ['Model'], uses: ['Base', 'k'] })
  })

  it('ignores strings and comments but reads f-string expressions', () => {
    expect(n('# uses ghost\nlabel = "ghost and phantom"\nmsg = f"{price:.2f} at {when}"')).toEqual({ defs: ['label', 'msg'], uses: ['price', 'when'] })
    expect(n('doc = """multi\nline ghost"""\nz = 1')).toEqual({ defs: ['doc', 'z'], uses: [] })
  })

  it('treats changing an object in place as a new value', () => {
    expect(n('df["ret"] = df.close.pct_change()')).toEqual({ defs: ['df'], uses: ['df'] })
    expect(n('xs.append(4)')).toEqual({ defs: ['xs'], uses: ['xs'] })
    expect(n('plt.plot(xs)')).toEqual({ defs: [], uses: ['plt', 'xs'] })
    expect(n('obj.attr = value')).toEqual({ defs: ['obj'], uses: ['obj', 'value'] })
  })
})

describe('which cells are stale', () => {
  const cells = (): CellRunInfo[] => [
    { id: 'a', type: 'code', source: 'x = 1' },
    { id: 'm', type: 'markdown', source: '# notes' },
    { id: 'b', type: 'code', source: 'y = x + 1' },
    { id: 'c', type: 'code', source: 'z = y * 2' },
    { id: 'd', type: 'code', source: 'w = 5' }
  ]
  const ran = (list: CellRunInfo[], order: string[]) => {
    order.forEach((id, i) => {
      const c = list.find((x) => x.id === id)!
      c.ranSource = c.source
      c.ranSeq = i + 1
    })
    return list
  }

  it('is fresh after running top to bottom; nothing ran means never', () => {
    const s = cellStates(ran(cells(), ['a', 'b', 'c', 'd']))
    expect([...s.values()].map((v) => v.state)).toEqual(['fresh', 'fresh', 'fresh', 'fresh'])
    expect(cellStates(cells()).get('a')!.state).toBe('never')
    expect(cellStates([{ id: 'a', type: 'code', source: 'x', hadOutput: true }]).get('a')!.state).toBe('earlier')
  })

  it('marks an edited cell, and everything downstream of it, but not unrelated cells', () => {
    const list = ran(cells(), ['a', 'b', 'c', 'd'])
    list[0].source = 'x = 2'
    const s = cellStates(list)
    expect(s.get('a')!.state).toBe('edited')
    expect(s.get('b')).toEqual({ state: 'stale', names: ['x'], from: ['a'] })
    expect(s.get('c')).toEqual({ state: 'stale', names: ['y'], from: ['b'] })
    expect(s.get('d')!.state).toBe('fresh')
    expect(staleOrder(list, s)).toEqual(['a', 'b', 'c'])
  })

  it('marks downstream cells after an upstream cell runs again', () => {
    const list = ran(cells(), ['a', 'b', 'c', 'd', 'a'])
    const s = cellStates(list)
    expect(s.get('a')!.state).toBe('fresh')
    expect(s.get('b')!.state).toBe('stale')
    expect(s.get('c')!.state).toBe('stale')
    // Running b again brings it up to date; c is still behind
    const again = ran(cells(), ['a', 'b', 'c', 'd', 'a', 'b'])
    const s2 = cellStates(again)
    expect(s2.get('b')!.state).toBe('fresh')
    expect(s2.get('c')!.state).toBe('stale')
  })

  it('follows the nearest definition above', () => {
    const list = ran([
      { id: 'a', type: 'code', source: 'x = 1' },
      { id: 'b', type: 'code', source: 'x = 10' },
      { id: 'c', type: 'code', source: 'print(x)' }
    ], ['a', 'b', 'c'])
    list[0].source = 'x = 2'
    const s = cellStates(list)
    expect(s.get('c')!.state).toBe('fresh')
  })
})

// ---------- Outputs ----------

describe('outputs', () => {
  it('picks the richest form Tide can draw', () => {
    expect(pickMime({ 'text/plain': 'x', 'text/html': '<b>x</b>' })).toBe('text/html')
    expect(pickMime({ 'text/plain': 'fig', 'image/png': 'AAA' })).toBe('image/png')
    expect(pickMime({ 'text/plain': 'chart', 'text/html': '<div>', 'application/vnd.plotly.v1+json': {} })).toBe('application/vnd.plotly.v1+json')
    expect(pickMime({ 'text/plain': 'curve', 'application/vnd.tide.finance+json': { kind: 'yield-curve' } })).toBe('application/vnd.tide.finance+json')
  })

  it('turns terminal colours into classes and escapes the rest', () => {
    expect(ansiToHtml('\u001b[0;31mValueError\u001b[0m: <bad>')).toBe('<span class="ansi-red">ValueError</span>: &lt;bad&gt;')
    expect(ansiToHtml('\u001b[1;32mok\u001b[0m')).toBe('<span class="ansi-green ansi-bold">ok</span>')
    expect(ansiToHtml('\u001b[38;5;208morange\u001b[39m plain')).toBe('orange plain')
  })

  it('settles progress bars that rewrite their line', () => {
    expect(settleStream('10%\r50%\r100%\ndone')).toBe('100%\ndone')
    expect(settleStream('abc\bd')).toBe('abd')
  })

  it('walks a market order through the book', () => {
    const asks: [number, number][] = [
      [100, 5],
      [101, 5],
      [103, 10]
    ]
    expect(walkBook(asks, 8)).toEqual({ filled: 8, avg: (500 + 303) / 8, last: 101, cost: 803 })
    expect(walkBook(asks, 50).filled).toBe(20)
  })
})

// ---------- The tutor ----------

describe('the tutor in the margin', async () => {
  const tutor = await import('../src/main/notebook/tutor')
  const ctx = (session: string) => ({ signal: new AbortController().signal, sources: [], emitSources: () => {}, step: () => 's', updateStep: () => {}, web: false, labId: `nb:${session}`, chatId: undefined })
  const tool = (name: string) => tutor.NOTEBOOK_TOOLS.find((t) => t.name === name)!

  it('proposes code only when the learner asked for it', async () => {
    tutor.setSnapshot('s1', { ref: { vault: 'a.ipynb' }, name: 'a', text: '### Cell 1 [code, run 1] id=c1\n```python\nx = 1\n```', code: [{ id: 'c1', source: 'x = 1' }], kernel: 'Ready' })
    expect(tutor.beginTurn('s1', 'explain', '')).toBe(false)
    expect(await tool('propose_cell').run({ source: 'x = 2', explanation: 'fix' }, ctx('s1'))).toMatch(/^Not proposed/)
    expect(tutor.beginTurn('s1', 'ask', 'just show me the code')).toBe(true)
    expect(tutor.beginTurn('s1', 'next', '')).toBe(true)
    expect(await tool('propose_cell').run({ source: 'y = x * 2', explanation: 'the next step', after_cell_id: 'c1' }, ctx('s1'))).toMatch(/^Proposed/)
    const [p] = tutor.pendingProposals('s1')
    expect(p).toMatchObject({ kind: 'insert', after: 'c1', cellType: 'code', source: 'y = x * 2' })
    tutor.resolveProposal(p.id, 'y = x * 3')
    expect(tutor.pendingProposals('s1')).toEqual([])
  })

  it('reads the notebook it was shown, and only for its own session', async () => {
    const text = await tool('read_notebook').run({}, ctx('s1'))
    expect(text).toContain('id=c1')
    await expect(tool('read_notebook').run({}, ctx('nobody'))).rejects.toThrow(/No notebook/)
  })

  it('says what each quick action asks', () => {
    expect(tutor.actionText({ action: 'debug', text: '', cellId: 'c1' }, () => 3)).toMatch(/debug the error in cell 3.*Don't fix it/)
    expect(tutor.actionText({ action: 'next', text: '' }, () => 0)).toMatch(/proposal/)
    expect(tutor.mayPropose('debug', 'why does this fail?')).toBe(false)
    expect(tutor.mayPropose('debug', 'fix it please')).toBe(true)
  })
})

// ---------- The quant pack's installer ----------

const READY = { ready: true, detail: 'Jupyter kernel 7.4.0…' }
const NOT_YET = { ready: false, detail: 'Not installed yet' }

function standIn(o: { uv?: boolean; statuses: { ready: boolean; detail: string }[]; fail?: Record<string, { code: number; err: string }>; free?: number | null; python?: boolean; lines?: string[] }) {
  const calls: string[] = []
  const statuses = [...o.statuses]
  const remembered: number[] = []
  let size = 168e6
  const d: PackInstaller = {
    python: '/env/bin/python',
    dir: '/env',
    uv: o.uv ? '/opt/homebrew/bin/uv' : null,
    exists: () => o.python ?? true,
    run: async (cmd, args, onLine) => {
      const line = [cmd, ...args].join(' ')
      calls.push(line)
      for (const l of o.lines ?? []) onLine?.(l)
      const f = Object.entries(o.fail ?? {}).find(([k]) => line.includes(k))
      if (f) return f[1]
      if (/install/.test(line)) size += 360e6
      return { code: 0, err: '' }
    },
    status: async () => statuses.shift() ?? NOT_YET,
    freeBytes: async () => (o.free === undefined ? 50e9 : o.free),
    sizeOf: async () => size,
    remember: (mb) => void remembered.push(mb),
    basePython: () => '/opt/homebrew/bin/python3',
    now: () => 0
  }
  return { d, calls, remembered }
}

describe('installing the quant pack', () => {
  it('uses uv when it is there, then cvxpy, then loads everything once, and measures the size', async () => {
    const { d, calls, remembered } = standIn({ uv: true, statuses: [NOT_YET, READY] })
    expect(await installPack(d)).toEqual(READY)
    expect(calls[0]).toBe(`/opt/homebrew/bin/uv pip install --python /env/bin/python ${QUANT_PACK.packages.join(' ')}`)
    expect(calls[1]).toBe('/opt/homebrew/bin/uv pip install --python /env/bin/python cvxpy')
    expect(calls[2]).toBe(`/env/bin/python -c import ${QUANT_PACK.modules.join(', ')}`)
    expect(remembered).toEqual([720])
  })

  it('falls back to pip without uv', async () => {
    const { d, calls } = standIn({ statuses: [NOT_YET, READY] })
    await installPack(d)
    expect(calls[0]).toMatch(/^\/env\/bin\/python -m pip install --disable-pip-version-check --progress-bar off ipykernel/)
  })

  it('installs cvxpy without OSQP when OSQP cannot be built', async () => {
    const { d, calls } = standIn({ uv: true, statuses: [NOT_YET, READY], fail: { 'python cvxpy': { code: 1, err: 'Failed to clone repository: https://github.com/osqp/osqp.git' } } })
    expect((await installPack(d)).ready).toBe(true)
    expect(calls).toContain('/opt/homebrew/bin/uv pip install --python /env/bin/python --no-deps cvxpy')
  })

  it('does nothing when it is there, and stops before downloading on a full disk', async () => {
    const there = standIn({ statuses: [READY] })
    expect(await installPack(there.d)).toEqual(READY)
    expect(there.calls).toEqual([])
    const full = standIn({ statuses: [NOT_YET], free: 0.5e9 })
    expect((await installPack(full.d)).detail).toMatch(/Not enough free space/)
    expect(full.calls).toEqual([])
  })

  it('creates the environment when there is none', async () => {
    const { d, calls } = standIn({ statuses: [NOT_YET, READY], python: false })
    await installPack(d)
    expect(calls[0]).toBe('/opt/homebrew/bin/python3 -m venv /env')
  })

  it('fails in words the learner can act on', async () => {
    const offline = standIn({ uv: true, statuses: [NOT_YET], fail: { ipykernel: { code: 2, err: 'error: Request failed after 3 retries\n  Caused by: dns error: failed to lookup address' } } })
    expect((await installPack(offline.d)).detail).toMatch(/check the internet connection/)
    expect(packFailure('ERROR: No matching distribution found for QuantLib')).toMatch(/too new or too old/)
    expect(packFailure('OSError: [Errno 28] No space left on device')).toMatch(/disk is full/)
  })

  it('says what uv and pip are doing', () => {
    expect(packProgress('Resolved 64 packages in 1.2s')).toBe('Found 64 packages…')
    expect(packProgress('Downloading scipy (19.4MiB)')).toBe('Downloading scipy (19.4MiB)…')
    expect(packProgress('Building cvxpy==1.9.3')).toBe('Building cvxpy==1.9.3 for this Mac…')
    expect(packProgress('Installed 61 packages in 210ms')).toBe('Installed 61 packages. Checking them…')
    expect(packProgress('Collecting arch')).toBe('Finding arch…')
    expect(packProgress('   ')).toBe('')
  })

  it('reads the status with the measured size', () => {
    const lines = QUANT_PACK.dists.map((p) => `${p} 1.0`).join('\n')
    expect(packStatusOf(lines, 712.4)).toMatchObject({ ready: true, sizeMb: 712.4 })
    expect(packStatusOf(lines, 712.4).detail).toContain('added 712 MB')
    expect(packStatusOf(lines.replace('cvxpy 1.0', 'cvxpy -')).detail).toBe('Not finished: cvxpy still to install')
    expect(installArgs({ python: '/p', uv: null }, ['a'])).toEqual(['/p', ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', 'a']])
    expect(findUv('/home', (p) => p === '/home/.local/bin/uv', {})).toBe('/home/.local/bin/uv')
    expect(findUv('/home', () => false, {})).toBeNull()
  })
})
