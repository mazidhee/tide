/**
 * Every quant-lab template runs top to bottom in a real kernel, with each exercise's solution in
 * place of its starter, and every exercise's hidden tests pass on that solution (and fail on the
 * starter). Needs the quant pack in TIDE_NB_PYTHON (a scratch environment); skipped without it.
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { Kernel, type KernelEvent } from '../src/main/notebook/kernel'
import { writeFinanceHelper } from '../src/main/finance/helper'
import TIDE_NB from '../src/main/notebook/tide_nb.py?raw'
import { QUANT_TEMPLATES, solvedCode, templateNotebook } from '../src/shared/notebook/templates'
import { parseNotebook, serializeNotebook } from '../src/shared/notebook/ipynb'
import { QUANT_PACK } from '../src/shared/labPack'

const PY = process.env.TIDE_NB_PYTHON ?? ''
const ready = (() => {
  if (!PY || !existsSync(PY)) return false
  try {
    execFileSync(PY, ['-c', `import ${QUANT_PACK.modules.join(', ')}`], { stdio: 'ignore', timeout: 120_000 })
    return true
  } catch {
    return false
  }
})()

describe('the templates as notebooks', () => {
  it('each is a valid notebook that survives a round trip, with its exercises marked', () => {
    for (const t of QUANT_TEMPLATES) {
      const nb = templateNotebook(t)
      const again = parseNotebook(serializeNotebook(nb))
      expect(again.cells.map((c) => c.source)).toEqual(nb.cells.map((c) => c.source))
      const exercises = t.cells.filter((c) => 'exercise' in c).length
      expect(again.cells.filter((c) => (c.metadata.tide as { exercise?: unknown } | undefined)?.exercise).length).toBe(exercises)
      expect(exercises).toBeGreaterThan(0)
      // Hidden tests never go into the file
      expect(serializeNotebook(nb)).not.toContain('assert')
    }
  })
})

describe.skipIf(!ready)('each template runs in a real kernel', () => {
  const root = mkdtempSync(join(tmpdir(), 'tide-nbt-'))
  const kernels: Kernel[] = []
  afterAll(async () => {
    await Promise.all(kernels.map((k) => k.shutdown()))
  })

  for (const t of QUANT_TEMPLATES) {
    it(`${t.title}`, async () => {
      const dir = join(root, t.id)
      const site = join(dir, 'site')
      mkdirSync(site, { recursive: true })
      await writeFinanceHelper(site)
      writeFileSync(join(site, 'tide_nb.py'), TIDE_NB)
      const events: KernelEvent[] = []
      const k = new Kernel({ python: PY, cwd: dir, env: { PATH: '/usr/bin:/bin', PYTHONPATH: site, MPLBACKEND: 'module://matplotlib_inline.backend_inline', MPLCONFIGDIR: join(dir, 'mpl') }, writable: [dir], bootstrap: 'import tide_nb as _tide_nb', onEvent: (e) => events.push(e) }, join(dir, 'kernel'))
      kernels.push(k)
      await k.start()
      const run = async (code: string, label: string, mustPass = true) => {
        const r = k.execute(code)
        const done = await r.done
        const err = events.find((e) => e.type === 'output' && e.parent === r.id && e.output.output_type === 'error')
        if (mustPass) expect(done.status, `${label}: ${err && err.type === 'output' ? `${err.output.ename}: ${err.output.evalue}` : ''}`).toBe('ok')
      }
      const check = async (tests: unknown) => JSON.parse(await k.evaluate(`_tide_nb.check(${JSON.stringify(JSON.stringify(tests))})`, 120_000)) as { ok: boolean; name: string; message?: string }[]
      let n = 0
      for (const c of t.cells) {
        if ('md' in c) continue
        n++
        if ('code' in c) {
          await run(c.code, `cell ${n} of ${t.id}`)
          continue
        }
        // The starter as the learner first sees it: its tests must not pass yet
        await run(c.exercise.starter, 'starter', false)
        expect((await check(c.exercise.tests)).some((r) => !r.ok), `${c.exercise.id}'s tests pass before it is answered`).toBe(true)
        await run(c.exercise.solution, `${c.exercise.id} solution`)
        expect((await check(c.exercise.tests)).filter((r) => !r.ok), c.exercise.id).toEqual([])
      }
      expect(solvedCode(t).length).toBe(n)
    }, 240_000)
  }
})
