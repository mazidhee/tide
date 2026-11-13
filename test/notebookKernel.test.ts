/**
 * The notebook's kernel, for real: ipykernel started under the sandbox and driven over ZeroMQ.
 * Needs a Python with the quant pack (ipykernel) in TIDE_NB_PYTHON (a scratch environment, never
 * Tide's own); skipped without one.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { Kernel, type KernelEvent } from '../src/main/notebook/kernel'
import { decode, encode, makeMessage, sign } from '../src/main/notebook/wire'
import TIDE_NB from '../src/main/notebook/tide_nb.py?raw'

const PY = process.env.TIDE_NB_PYTHON ?? ''
const hasKernel = (() => {
  if (!PY || !existsSync(PY)) return false
  try {
    execFileSync(PY, ['-c', 'import ipykernel, pandas, matplotlib'], { stdio: 'ignore', timeout: 60_000 })
    return true
  } catch {
    return false
  }
})()

describe('the wire protocol', () => {
  it('signs, encodes and decodes a message, and refuses a forged one', () => {
    const m = makeMessage('execute_request', { code: '1+1' }, 'sess')
    const frames = encode(m, 'secret').map((f) => Buffer.from(f))
    const back = decode(frames, 'secret')!
    expect(back.header.msg_type).toBe('execute_request')
    expect(back.content).toEqual({ code: '1+1' })
    expect(decode(frames, 'other')).toBeNull()
    expect(sign('', ['a'])).toBe('')
    const withId = encode(m, 'k', [Buffer.from('id1')]).map((f) => Buffer.from(f))
    expect(decode(withId, 'k')!.identities[0].toString()).toBe('id1')
  })
})

describe.skipIf(!hasKernel)('a real kernel', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tide-nb-'))
  const site = join(dir, 'site')
  execFileSync('/bin/mkdir', ['-p', site])
  writeFileSync(join(site, 'tide_nb.py'), TIDE_NB)
  const events: KernelEvent[] = []
  const k = new Kernel(
    {
      python: PY,
      cwd: dir,
      env: { PATH: '/usr/bin:/bin', PYTHONPATH: site, MPLBACKEND: 'module://matplotlib_inline.backend_inline', MPLCONFIGDIR: join(dir, 'mpl') },
      writable: [join(dir, 'work'), join(dir, 'mpl')],
      bootstrap: 'import tide_nb as _tide_nb\n_tide_nb.theme({"ink": "#111111", "series": ["#2a78d6"]})',
      onEvent: (e) => events.push(e)
    },
    join(dir, 'kernel')
  )
  afterAll(() => k.shutdown())

  const outputsOf = (id: string) => events.filter((e): e is Extract<KernelEvent, { type: 'output' }> => e.type === 'output' && e.parent === id).map((e) => e.output)

  it('starts, runs a cell and counts it', async () => {
    await k.start()
    expect(k.state).toBe('idle')
    const r = k.execute('x = 41\nprint("hi")\nx + 1')
    const done = await r.done
    expect(done.status).toBe('ok')
    expect(done.count).toBe(1)
    const outs = outputsOf(r.id)
    expect(outs.some((o) => o.output_type === 'stream' && o.text === 'hi\n')).toBe(true)
    expect(outs.find((o) => o.output_type === 'execute_result')!.data).toMatchObject({ 'text/plain': '42' })
  }, 90_000)

  it('shows a plot as a picture and a DataFrame as a table', async () => {
    const r = k.execute('import matplotlib.pyplot as plt, pandas as pd\nplt.plot([1,2,3])\nplt.show()\npd.DataFrame({"a": [1, 2], "b": [3, 4]})')
    await r.done
    const outs = outputsOf(r.id)
    expect(outs.some((o) => o.output_type === 'display_data' && typeof (o.data as Record<string, string>)['image/png'] === 'string')).toBe(true)
    expect(String((outs.find((o) => o.output_type === 'execute_result')!.data as Record<string, string>)['text/html'])).toContain('<table')
  }, 60_000)

  it('reports an error with its traceback, and drops queued runs after it', async () => {
    const a = k.execute('1/0')
    const b = k.execute('y = 2')
    expect((await a.done).status).toBe('error')
    expect((await b.done).status).toBe('aborted')
    const err = outputsOf(a.id).find((o) => o.output_type === 'error')!
    expect(err.ename).toBe('ZeroDivisionError')
    expect((err.traceback as string[]).length).toBeGreaterThan(0)
  }, 30_000)

  it('lists variables and runs hidden tests through tide_nb', async () => {
    const vars = JSON.parse(await k.evaluate('_tide_nb.variables()'))
    expect(vars.find((v: { name: string }) => v.name === 'x')).toMatchObject({ type: 'int', value: '41' })
    const res = JSON.parse(await k.evaluate(`_tide_nb.check(${JSON.stringify(JSON.stringify([{ name: 'x is 41', code: 'assert x == 41' }, { name: 'x is 42', code: 'assert x == 42, "x should be 42"' }]))})`))
    expect(res).toEqual([{ name: 'x is 41', ok: true }, { name: 'x is 42', ok: false, message: 'x should be 42' }])
  }, 30_000)

  it('cannot write outside its folders', async () => {
    const r = k.execute(`open(${JSON.stringify(join(dir, 'escape.txt'))}, "w").write("x")`)
    expect((await r.done).status).toBe('error')
    expect(existsSync(join(dir, 'escape.txt'))).toBe(false)
  }, 30_000)

  it('interrupts a long run and keeps the variables', async () => {
    const r = k.execute('import time\ntime.sleep(30)')
    await new Promise((res) => setTimeout(res, 800))
    k.interrupt()
    const done = await r.done
    expect(done.status).toBe('error')
    expect(outputsOf(r.id).find((o) => o.output_type === 'error')!.ename).toBe('KeyboardInterrupt')
    const again = k.execute('x')
    await again.done
    expect(outputsOf(again.id).find((o) => o.output_type === 'execute_result')!.data).toMatchObject({ 'text/plain': '41' })
  }, 30_000)

  it('restarts: variables gone, counts start again', async () => {
    await k.restart()
    expect(k.state).toBe('idle')
    const r = k.execute('x')
    const done = await r.done
    expect(done.status).toBe('error')
    expect(done.count).toBe(1)
    expect(events.some((e) => e.type === 'status' && e.state === 'restarting')).toBe(true)
  }, 90_000)
})
