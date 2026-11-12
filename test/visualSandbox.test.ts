/**
 * Claude's visuals in a real Electron (test/fixtures/visual-harness): served by the app's own
 * scheme handler, in sandboxed frames under the packaged app's CSP, with local servers counting
 * anything that gets out. Proves a visual can't fetch, connect, read the page or window.tide,
 * navigate the window or itself, or hold the machine (a loop, memory, a busy core).
 */
import { spawnSync } from 'child_process'
import { copyFileSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { build } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'
import { APP_CSP } from '../src/shared/appCsp'

const here = resolve('test/fixtures/visual-harness')
const electron = resolve('node_modules/.bin/electron')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let r: any

const shared = {
  name: 'shared-alias',
  setup(b: import('esbuild').PluginBuild) {
    b.onResolve({ filter: /^@shared\// }, (a) => ({ path: resolve('src/shared', a.path.slice(8) + '.ts') }))
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let bare: any

function runHarness(out: string, page: string) {
  const run = spawnSync(electron, [out], { encoding: 'utf8', timeout: 110_000, env: { ...process.env, HARNESS_PAGE: page } })
  const line = (run.stdout ?? '').split('\n').find((l) => l.startsWith('RESULT '))
  if (!line) throw new Error(`the harness gave no result:\n${run.stdout}\n${run.stderr}`)
  return JSON.parse(line.slice(7))
}

beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), 'tide-visual-harness-'))
  await build({ entryPoints: [join(here, 'main.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(out, 'main.cjs'), plugins: [shared], logLevel: 'silent' })
  await build({ entryPoints: [join(here, 'parent.ts')], bundle: true, platform: 'browser', format: 'iife', outfile: join(out, 'parent.js'), plugins: [shared], logLevel: 'silent' })
  copyFileSync(join(here, 'preload.cjs'), join(out, 'preload.cjs'))
  writeFileSync(join(out, 'parent.html'), `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${APP_CSP}"><title>the app page</title></head><body><script src="parent.js"></script></body></html>`)
  writeFileSync(join(out, 'bare.html'), `<!doctype html><html><head><title>the app page</title></head><body><script src="parent.js"></script></body></html>`)
  writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'tide-visual-harness', main: 'main.cjs' }))
  r = runHarness(out, 'parent.html')
  bare = runHarness(out, 'bare.html')
}, 240_000)

describe('a visual in its sandbox', () => {
  it('ran every case', () => {
    expect(r.crashed).toBeUndefined()
    expect(r.timeout).toBeUndefined()
  })

  it('reaches nothing on the network: no request, connection or packet arrived', () => {
    expect(r.hits).toEqual([])
    expect(r.tcpConnections).toBe(0)
    expect(r.udpPackets).toBe(0)
    expect(r.turnConnections).toBe(0)
  })

  it('cannot fetch, and is told why', () => {
    expect(JSON.parse(r.fetch.reports[0])).toEqual({ f: 'blocked' })
    expect(r.fetch.errors.join(' ')).toMatch(/Blocked by the sandbox \(connect-src/)
  })

  it('loads no images, styles, fonts or media from anywhere', () => {
    expect(r.resources.reports).toEqual(['ok'])
    expect(r.resources.errors.join(' ')).toMatch(/img-src/)
  })

  it('opens no sockets, event streams, beacons or workers', () => {
    const c = JSON.parse(r.connections.reports[0])
    expect(c.beacon).toBe(false)
    expect(c.imp).toBe('blocked')
    expect(r.connections.errors.join(' ')).toMatch(/worker-src/)
  })

  it('keeps no resource hints or speculation rules', () => {
    expect(JSON.parse(r.hints.reports[0])).toEqual({ links: 0, l: false, m: false })
  })

  it('has no WebRTC, and nested frames are taken out before they load', () => {
    const w = JSON.parse(r.webrtc.reports[0])
    expect(w.rtc).toBe('undefined')
    expect(w.wk).toBe('undefined')
    expect(w.md).toBe('undefined')
    expect(w.err).toBe('TypeError')
    expect(w.appended).toBe(false)
    expect(w.appended2).toBe(false)
    expect(w.inner).toBe('0:1')
    expect(w.adjacent).toBe(0)
    // SVG markup set as text stays SVG
    expect(w.svg).toBe('0:http://www.w3.org/2000/svg')
    expect(w.shadow).toBe(0)
    expect(w.write).toBe('refused')
    expect(w.frames).toBe(0)
  })

  it("can't read the page, window.tide, storage or Node", () => {
    const p = JSON.parse(r.parent.reports[0])
    expect(p.tide).toBe('undefined')
    expect(p.parentTide).toMatch(/threw SecurityError/)
    expect(p.parentSecret).toMatch(/threw SecurityError/)
    expect(p.parentDoc).toMatch(/threw SecurityError/)
    expect(p.topHref).toMatch(/threw SecurityError/)
    expect(p.ls).toMatch(/threw SecurityError/)
    expect(p.ss).toMatch(/threw SecurityError/)
    expect(p.idb).toMatch(/threw SecurityError/)
    expect(p.origin).toBe('null')
    expect(p.require).toBe('undefined')
    expect(p.process).toBe('undefined')
    expect(r.pageSecretStillThere).toBe('the vault path')
  })

  it("can't navigate the window or open one", () => {
    const t = JSON.parse(r.topnav.reports[0])
    expect(t.top).toMatch(/threw/)
    expect(t.open).toBe('null')
    expect(r.topNavigations).toEqual([])
    expect(r.windowUrl).toMatch(/parent\.html$/)
    expect(r.pageTitle).toBe('the app page')
  })

  it("can't navigate itself away or submit a form", () => {
    expect(r.form.reports).toEqual(['still here at tide-visual:'])
    // A frame that tries to leave is stopped: its process is killed and nothing else loads in it
    for (const k of ['selfnav', 'dataNav', 'blobNav', 'linkNav', 'metaRefresh']) {
      expect(r[k].reports, k).toEqual([])
      expect(r[k].frames.filter((u: string) => /^(http|data|blob)/.test(u)), k).toEqual([])
    }
    expect(r.killed.filter((k: { reason: string }) => /leave its page/.test(k.reason)).length).toBe(5)
  })

  it("without the page's CSP, main alone still stops a frame leaving and cancels its requests", () => {
    expect(bare.crashed).toBeUndefined()
    expect(bare.hits).toEqual([])
    expect(bare.tcpConnections).toBe(0)
    expect(bare.fetch.reports).toEqual(['blocked'])
    for (const k of ['selfnav', 'dataNav', 'blobNav']) expect(bare[k].reports, k).toEqual([])
    expect(bare.killed.filter((k: { reason: string }) => /leave its page/.test(k.reason)).length).toBe(3)
  })

  it('a frame that never yields leaves the page running, stops beating, and its process can be killed', () => {
    const l = r.loop
    expect(l.pid).toBeGreaterThan(0)
    expect(l.pid).not.toBe(r.rendererPid)
    expect(l.beatsAfter).toBe(l.beatsBefore)
    expect(l.sinceBeat).toBeGreaterThan(1000)
    expect(l.parentTicks).toBeGreaterThan(40)
    expect(l.killed).toBe(true)
    expect(l.alive).toBe(false)
  })

  it('a frame that takes too much memory is killed by the watchdog', () => {
    expect(r.memory.pid).toBeGreaterThan(0)
    expect(r.memory.alive).toBe(false)
    expect(r.memory.killed[0].reason).toMatch(/memory/)
  })

  it('a frame that keeps a core busy is killed by the watchdog', () => {
    expect(r.cpu.alive).toBe(false)
    expect(r.cpu.killed[0].reason).toMatch(/processor/)
  })

  it('a good visual is ready, drawn, stepped and reports, with every message valid', () => {
    const g = r.good
    expect(g.invalid).toBe(0)
    expect(g.beats).toBeGreaterThan(0)
    const ready = g.messages.find((m: { t: string }) => m.t === 'ready')
    expect(ready).toMatchObject({ drawn: true, steps: 3 })
    expect(g.messages.filter((m: { t: string }) => m.t === 'error')).toEqual([])
    expect(g.messages).toContainEqual({ t: 'report', text: 'ready to count', data: { n: 3 } })
    const steps = g.messages.filter((m: { t: string }) => m.t === 'steps')
    expect(steps[0]).toMatchObject({ i: 0, n: 3, say: 'one' })
    expect(steps[steps.length - 1]).toMatchObject({ i: 1, n: 3, say: 'two' })
  })

  it("the examples in Claude's instructions run cleanly", () => {
    expect(r.examples).toHaveLength(2)
    for (const e of r.examples) {
      expect(e.errors).toEqual([])
      expect(e.ready).toMatchObject({ drawn: true })
      expect(e.invalid).toBe(0)
    }
    // Seven inserts and two resizes (4 → 8 → 16)
    expect(r.examples[0].ready.steps).toBe(9)
    expect(r.examples[0].steps).toBeGreaterThan(0)
  })

  it('errors in a visual are caught and reported, and a blank one is noticed', () => {
    expect(r.broken.reports).toEqual(['before'])
    expect(r.broken.errors.join('\n')).toMatch(/undefinedThing is not defined/)
    expect(r.broken.errors.join('\n')).toMatch(/SyntaxError|Unexpected token/)
    expect(r.blank.ready).toMatchObject({ drawn: false })
  })
})
