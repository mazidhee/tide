/** The harness page (see main.ts): runs each visual in a sandboxed frame, as the app does, and records what came back */
import { VISUAL_GUIDE, frameUrl, parseFrameMessage, type FrameMessage } from '../../../src/shared/visuals'

declare const harness: {
  ports(): Promise<{ http: number; udp: number; turn: number }>
  watch(host: string): Promise<void>
  unwatch(host: string): Promise<void>
  pid(host: string): Promise<number | null>
  kill(host: string): Promise<boolean>
  alive(pid: number): Promise<boolean>
  frames(): Promise<string[]>
  killed(): Promise<{ host: string; reason: string }[]>
  done(r: unknown): Promise<void>
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
let n = 0
const host = () => `vharness${++n}${Math.random().toString(36).slice(2, 8)}`

interface Run {
  host: string
  frame: HTMLIFrameElement
  messages: FrameMessage[]
  invalid: number
  beats: number
  lastBeat: number
}

function start(code: string): Run {
  const r: Run = { host: host(), frame: document.createElement('iframe'), messages: [], invalid: 0, beats: 0, lastBeat: 0 }
  r.frame.setAttribute('sandbox', 'allow-scripts')
  r.frame.style.cssText = 'width:600px;height:300px;border:0'
  const onMessage = (e: MessageEvent) => {
    if (e.source !== r.frame.contentWindow) return
    const m = parseFrameMessage(e.data)
    if (!m) return void r.invalid++
    if (m.t === 'beat') {
      r.beats++
      r.lastBeat = performance.now()
    } else r.messages.push(m)
  }
  addEventListener('message', onMessage)
  r.frame.src = frameUrl(r.host, code, { scheme: 'dark', tokens: { ink: '#eeeeee', bg: '#111111' } })
  document.body.append(r.frame)
  return r
}

const reports = (r: Run) => r.messages.filter((m): m is Extract<FrameMessage, { t: 'report' }> => m.t === 'report').map((m) => m.text)
const errors = (r: Run) => r.messages.filter((m): m is Extract<FrameMessage, { t: 'error' }> => m.t === 'error').map((m) => m.msg)
const ready = (r: Run) => r.messages.find((m) => m.t === 'ready') ?? null

async function attack(code: string, ms = 1500) {
  const r = start(code)
  await wait(ms)
  const frameUrlNow = (() => {
    try {
      return r.frame.contentWindow?.location.href
    } catch {
      return 'cross-origin'
    }
  })()
  const frames = await harness.frames()
  const result = { frames, reports: reports(r), errors: errors(r), ready: ready(r), beats: r.beats, invalid: r.invalid, src: r.frame.src.slice(0, 40), frameUrlNow }
  r.frame.remove()
  return result
}

async function main() {
  const { http, udp, turn } = await harness.ports()
  const H = `http://127.0.0.1:${http}`
  const results: Record<string, unknown> = {}
  // Without the page's CSP (as in development before main adds frame-src): main's own guards alone
  const bare = !document.querySelector('meta[http-equiv]')
  const navOnly = async () => {
    const stay = (ms: number) => `setTimeout(() => visual.report('still here at ' + location.protocol), ${ms})`
    results.selfnav = await attack(`<p>x</p><script>setTimeout(() => { location.href = '${H}/self' }, 100); ${stay(700)}</script>`)
    results.dataNav = await attack(`<p>x</p><script>setTimeout(() => { location.href = 'data:text/html,<p>away</p>' }, 100); ${stay(700)}</script>`)
    results.blobNav = await attack(`<p>x</p><script>setTimeout(() => { location.href = URL.createObjectURL(new Blob(['<p>away</p>'], { type: 'text/html' })) }, 100); ${stay(700)}</script>`)
    results.fetch = await attack(`<p>x</p><script>fetch('${H}/fetch').then(() => visual.report('ok'), () => visual.report('blocked'))</script>`)
    results.killed = await harness.killed()
    await harness.done(results)
  }
  if (bare) return navOnly()

  results.fetch = await attack(`<p>x</p><script>
    const r = {}
    fetch('${H}/fetch').then(() => r.f = 'ok', () => r.f = 'blocked').finally(() => visual.report(JSON.stringify(r)))
  </script>`)

  results.resources = await attack(`<p>x</p><img src="${H}/img" alt=""><div style="background:url(${H}/css);width:10px;height:10px"></div>
    <style>@import url(${H}/import); @font-face { font-family: x; src: url(${H}/font) } body { font-family: x } p { background: url(${H}/css2) }</style>
    <audio src="${H}/audio" autoplay></audio><video src="${H}/video" autoplay></video>
    <svg><image href="${H}/svgimage" width="5" height="5"/></svg><script>visual.report('ok')</script>`)

  results.connections = await attack(`<p>x</p><script>
    const r = {}
    try { new WebSocket('ws://127.0.0.1:${http}/ws'); r.ws = 'made' } catch (e) { r.ws = 'threw' }
    try { new EventSource('${H}/es'); r.es = 'made' } catch (e) { r.es = 'threw' }
    try { r.beacon = navigator.sendBeacon('${H}/beacon', 'x') } catch (e) { r.beacon = 'threw' }
    try { new Worker(URL.createObjectURL(new Blob(['fetch("${H}/worker")']))); r.worker = 'made' } catch (e) { r.worker = 'threw ' + e.name }
    try { new SharedWorker(URL.createObjectURL(new Blob(['fetch("${H}/sworker")']))); r.sw = 'made' } catch (e) { r.sw = 'threw ' + e.name }
    try { import('${H}/import.js').then(() => r.imp = 'ok', () => r.imp = 'blocked') } catch (e) { r.imp = 'threw' }
    const a = document.createElement('a'); a.href = '${H}/ping'; a.ping = '${H}/pinged'; document.body.append(a)
    setTimeout(() => visual.report(JSON.stringify(r)), 700)
  </script>`)

  results.hints = await attack(`<link rel="preconnect" href="${H}"><link rel="dns-prefetch" href="${H}"><link rel="prefetch" href="${H}/prefetch">
    <link rel="preload" as="image" href="${H}/preload"><link rel="stylesheet" href="${H}/sheet.css"><link rel="modulepreload" href="${H}/mod.js">
    <script type="speculationrules">{"prefetch":[{"source":"list","urls":["${H}/spec"]}]}</script>
    <p>x</p><script>
    const l = document.createElement('link'); l.rel = 'preconnect'; l.href = 'http://127.0.0.1:${http}'; document.head.appendChild(l)
    const m = document.createElement('link'); m.rel = 'prefetch'; m.href = '${H}/prefetch2'; document.head.append(m)
    visual.report(JSON.stringify({ links: document.querySelectorAll('link').length, l: l.isConnected, m: m.isConnected }))
  </script>`)

  results.webrtc = await attack(`<p>x</p><script>
    const r = { rtc: typeof RTCPeerConnection, wk: typeof webkitRTCPeerConnection, md: typeof navigator.mediaDevices }
    try { const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${udp}' }, { urls: 'turn:127.0.0.1:${turn}?transport=tcp', username: 'u', credential: 'p' }] }); pc.createDataChannel('x'); pc.createOffer().then((o) => pc.setLocalDescription(o)); r.made = 1 } catch (e) { r.err = e.name }
    const nested = '<script>const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${udp}" }] }); pc.createDataChannel("x"); pc.createOffer().then((o) => pc.setLocalDescription(o))<\\/script>'
    const f = document.createElement('iframe'); f.srcdoc = nested; document.body.appendChild(f); r.appended = f.isConnected
    const g = document.createElement('iframe'); g.srcdoc = nested; document.body.append(g); r.appended2 = g.isConnected
    const d = document.createElement('div'); d.innerHTML = '<iframe srcdoc="' + nested.replace(/"/g, '&quot;') + '"></iframe><b>kept</b>'; document.body.appendChild(d); r.inner = d.querySelectorAll('iframe').length + ':' + d.querySelectorAll('b').length
    d.insertAdjacentHTML('beforeend', '<iframe srcdoc="x"></iframe>'); r.adjacent = d.querySelectorAll('iframe').length
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.innerHTML = '<foreignObject><iframe></iframe></foreignObject><circle r="2"/>'; document.body.append(s)
    r.svg = s.querySelectorAll('iframe').length + ':' + (s.querySelector('circle') && s.querySelector('circle').namespaceURI)
    const host = document.createElement('div'); document.body.append(host); const sr = host.attachShadow({ mode: 'closed' }); sr.innerHTML = '<iframe srcdoc="x"></iframe>'; const i2 = document.createElement('iframe'); sr.appendChild(i2); r.shadow = sr.querySelectorAll('iframe').length
    try { document.write('<iframe></iframe>'); r.write = 'ran' } catch (e) { r.write = 'refused' }
    r.frames = window.frames.length
    setTimeout(() => visual.report(JSON.stringify(r)), 2000)
  </script>`, 3000)

  results.parent = await attack(`<p>x</p><script>
    const r = {}
    const t = (k, f) => { try { r[k] = String(f()) } catch (e) { r[k] = 'threw ' + e.name } }
    t('tide', () => typeof window.tide)
    t('parentTide', () => typeof parent.tide)
    t('parentSecret', () => parent.tide.secret)
    t('parentDoc', () => parent.document.title)
    t('topHref', () => top.location.href)
    t('ls', () => localStorage.length)
    t('ss', () => sessionStorage.length)
    t('idb', () => indexedDB.open('x') && 'opened')
    t('cookie', () => (document.cookie = 'a=1', document.cookie))
    t('opener', () => window.opener)
    t('origin', () => origin)
    t('require', () => typeof require)
    t('process', () => typeof process)
    t('electron', () => typeof window.electron)
    visual.report(JSON.stringify(r))
  </script>`)

  results.topnav = await attack(`<p>x</p><script>
    const r = {}
    try { top.location.href = '${H}/top'; r.top = 'no throw' } catch (e) { r.top = 'threw ' + e.name }
    try { parent.location = '${H}/parent'; r.parent = 'no throw' } catch (e) { r.parent = 'threw ' + e.name }
    const a = document.createElement('a'); a.href = '${H}/a-top'; a.target = '_top'; document.body.append(a); a.click()
    try { r.open = String(window.open('${H}/popup')) } catch (e) { r.open = 'threw ' + e.name }
    const b = document.createElement('a'); b.href = '${H}/a-blank'; b.target = '_blank'; document.body.append(b); b.click()
    setTimeout(() => visual.report(JSON.stringify(r)), 400)
  </script>`)

  const stay = (ms: number) => `setTimeout(() => visual.report('still here at ' + location.protocol), ${ms})`
  results.form = await attack(`<p>x</p><form action="${H}/form" method="post"><input name="a" value="1"></form><script>
    try { document.forms[0].submit() } catch (e) {}
    ${stay(700)}
  </script>`)
  results.selfnav = await attack(`<p>x</p><script>
    setTimeout(() => { location.href = '${H}/self' }, 100)
    ${stay(700)}
  </script>`)
  results.blobNav = await attack(`<p>x</p><script>setTimeout(() => { location.href = URL.createObjectURL(new Blob(['<p>away</p>'], { type: 'text/html' })) }, 100); ${stay(700)}</script>`)
  results.dataNav = await attack(`<p>x</p><script>
    setTimeout(() => { location.href = 'data:text/html,<p>away</p>' }, 100)
    ${stay(700)}
  </script>`)
  results.linkNav = await attack(`<p>x</p><script>
    setTimeout(() => { const a = document.createElement('a'); a.href = '${H}/link'; document.body.append(a); a.click() }, 100)
    ${stay(700)}
  </script>`)

  results.metaRefresh = await attack(`<meta http-equiv="refresh" content="0;url=${H}/meta"><p>x</p><script>setTimeout(() => visual.report('still here'), 800)</script>`, 1500)

  // A frame that never yields: the page goes on, and the frame's process can be killed
  {
    const r = start(`<p>x</p><script>visual.report('start'); setTimeout(() => { while (true) {} }, 300)</script>`)
    let ticks = 0
    const tick = setInterval(() => ticks++, 50)
    await wait(1500)
    const pid = await harness.pid(r.host)
    const beatsBefore = r.beats
    await wait(1200)
    const sinceBeat = performance.now() - r.lastBeat
    const killed = await harness.kill(r.host)
    await wait(400)
    const alive = pid ? await harness.alive(pid) : null
    clearInterval(tick)
    results.loop = { pid, beatsBefore, beatsAfter: r.beats, sinceBeat: Math.round(sinceBeat), killed, alive, parentTicks: ticks }
    r.frame.remove()
  }

  // Memory and CPU limits, enforced by main's watchdog
  {
    const r = start(`<p>x</p><script>const a = []; setInterval(() => { for (let i = 0; i < 8; i++) a.push(new Float64Array(1e6).fill(Math.random())) }, 40)</script>`)
    await harness.watch(r.host)
    const pid = await (async () => {
      for (let i = 0; i < 20; i++) {
        const p = await harness.pid(r.host)
        if (p) return p
        await wait(100)
      }
      return null
    })()
    await wait(4000)
    results.memory = { pid, alive: pid ? await harness.alive(pid) : null, killed: (await harness.killed()).filter((k) => k.host === r.host) }
    r.frame.remove()
  }
  {
    const r = start(`<p>x</p><script>setInterval(() => { const t = Date.now(); while (Date.now() - t < 280) {} }, 300)</script>`)
    await harness.watch(r.host)
    await wait(600)
    const pid = await harness.pid(r.host)
    await wait(4500)
    results.cpu = { pid, beats: r.beats, alive: pid ? await harness.alive(pid) : null, killed: (await harness.killed()).filter((k) => k.host === r.host) }
    r.frame.remove()
  }

  // A good visual: steps, a report, nothing wrong
  {
    const r = start(`<title>Counting</title><svg viewBox="0 0 100 20" role="img" aria-label="count"><text id="t" x="4" y="14">0</text></svg><script>
      visual.steps(['one', 'two', 'three'], (i) => { document.getElementById('t').textContent = String(i + 1) })
      visual.report('ready to count', { n: 3 })
    </script>`)
    await wait(900)
    r.frame.contentWindow?.postMessage({ tv: 1, t: 'control', action: 'next' }, '*')
    await wait(300)
    results.good = { messages: r.messages, beats: r.beats, invalid: r.invalid }
    r.frame.remove()
  }

  // A frame taken out has its process ended at once, not seconds later
  {
    const r = start(`<p>x</p>`)
    await harness.watch(r.host)
    await wait(1500)
    const pid = await harness.pid(r.host)
    r.frame.remove()
    await harness.unwatch(r.host)
    const t0 = performance.now()
    let gone = -1
    while (performance.now() - t0 < 5000) {
      if (pid && !(await harness.alive(pid))) {
        gone = Math.round(performance.now() - t0)
        break
      }
      await wait(50)
    }
    results.teardown = { pid, gone }
  }

  // The examples Claude is shown run cleanly
  results.examples = []
  for (const m of VISUAL_GUIDE.matchAll(/```visual\n([\s\S]*?)\n```/g)) {
    const r = start(m[1])
    await wait(1200)
    ;(results.examples as unknown[]).push({ errors: errors(r), ready: ready(r), steps: r.messages.filter((x) => x.t === 'steps').length, invalid: r.invalid })
    r.frame.remove()
  }

  // Every step drawn once on request: a draw that throws at step 2, labels that overlap at step 3
  {
    const r = start(`<svg viewBox="0 0 300 60" width="300"><text id="a" x="10" y="30">sum of exp = 39.47</text><text id="b" x="200" y="30">weights sum = 1.00</text></svg><script>
      visual.steps(['one', 'two', 'three'], (i) => { if (i === 1) throw new Error('no data for step 2'); document.getElementById('b').setAttribute('x', i === 2 ? '40' : '200') })
    </script>`)
    await wait(700)
    r.frame.contentWindow?.postMessage({ tv: 1, t: 'control', action: 'audit' }, '*')
    await wait(500)
    results.audit = r.messages.find((m) => m.t === 'audit') ?? null
    results.auditSteps = r.messages.filter((m) => m.t === 'steps').pop() ?? null
    r.frame.remove()
  }

  // Errors are caught and reported
  results.broken = await attack(`<p>x</p><script>visual.report('before'); undefinedThing.call()</script><script>let = ;</script>`, 900)
  results.blank = await attack(`<script>/* draws nothing */</script>`, 900)

  results.pageTitle = document.title
  results.pageSecretStillThere = (window as unknown as { tide: { secret: string } }).tide.secret
  results.killed = await harness.killed()
  await harness.done(results)
}

main().catch((e) => harness.done({ crashed: String(e && (e as Error).stack) }))
