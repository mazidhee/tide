/**
 * One visual in the real frame, in a hidden Electron window: served by Tide's own frame document
 * and libraries (the bundle from harness.ts), checked as Tide checks it (ready, drawn, every step
 * drawn once for errors and overlapping labels), a 3D canvas checked for being blank, and
 * photographed at a step. Shared by the gallery and the scene pre-generator.
 */
const { protocol } = require('electron')
const { execFileSync } = require('child_process')
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('fs')
const { join } = require('path')
const os = require('os')

/** Tide's light and dark themes as the frame receives them (renderer lib/visuals readTheme) */
const THEMES = {
  light: { scheme: 'light', tokens: { bg: '#ffffff', surface: '#f5f7fa', ink: '#121a26', 'ink-soft': '#414b5a', muted: '#5f6a7b', line: '#e1e6ed', 'line-strong': '#c9d1dc', accent: '#1257b8', 'accent-soft': 'rgb(231, 238, 248)', pos: '#1257b8', neg: '#eb6834', good: '#1baf7a', bad: '#b3261e', warn: '#8a5600', c1: '#1257b8', c2: '#eb6834', c3: '#1baf7a', c4: '#eda100', c5: '#e87ba4', c6: '#6250d6' } },
  dark: { scheme: 'dark', tokens: { bg: '#1a212c', surface: '#141a23', ink: '#e7eaf0', 'ink-soft': '#b3bbc9', muted: '#8993a5', line: '#242c39', 'line-strong': '#364152', accent: '#7db5f5', 'accent-soft': 'rgb(35, 48, 64)', pos: '#7db5f5', neg: '#d95926', good: '#199e70', bad: '#f08a80', warn: '#e8b04a', c1: '#7db5f5', c2: '#d95926', c3: '#199e70', c4: '#c98500', c5: '#d55181', c6: '#9085e9' } }
}

function serve(H) {
  protocol.handle(H.VISUAL_SCHEME, (req) => {
    const u = new URL(req.url)
    if (u.pathname.startsWith('/lib/')) {
      const lib = H.libraryResponse(u.pathname)
      return lib ? new Response(lib.body, { headers: lib.headers }) : new Response('no', { status: 404 })
    }
    const r = H.frameResponse(req.url)
    return r ? new Response(r.body, { headers: r.headers }) : new Response('no', { status: 404 })
  })
}

/** The visual with its Python trace in front, when it asks for one */
function traced(H, code, o) {
  const src = H.traceSourceOf(code)
  if (!src) return code
  const dir = mkdtempSync(join(os.tmpdir(), 'tide-shot-'))
  try {
    writeFileSync(join(dir, 'snippet.py'), src)
    execFileSync(o.python || 'python3', ['-I', o.tracer, join(dir, 'snippet.py'), join(dir, 'trace.json')], { timeout: 8000 })
    return H.withTrace(code, { trace: H.cleanTrace(JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8'))) })
  } catch (e) {
    return H.withTrace(code, { error: String(e.message || e).slice(0, 200) })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const PARENT = (bg, width) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:${bg}}iframe{display:block;border:0;width:${width}px;height:200px}</style></head><body><iframe id="f" sandbox="allow-scripts"></iframe><script>
window.log = []; window.ready = null; window.audit = null; window.step = null
addEventListener('message', (e) => { const m = e.data; if (!m || m.tv !== 1) return
  if (m.t === 'size' || m.t === 'ready') document.getElementById('f').style.height = Math.min(1400, m.h) + 'px'
  if (m.t === 'ready') window.ready = m
  if (m.t === 'audit') window.audit = m.problems
  if (m.t === 'steps') window.step = m
  if (m.t === 'error' || m.t === 'warn') window.log.push(m.t + ': ' + m.msg) })
</script></body></html>`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** How much of a region is not the background: a blank canvas is nearly all background */
function inked(img, bgHex) {
  const { width, height } = img.getSize()
  if (!width || !height) return 0
  const px = img.toBitmap()
  const bg = [parseInt(bgHex.slice(5, 7), 16), parseInt(bgHex.slice(3, 5), 16), parseInt(bgHex.slice(1, 3), 16)]
  let on = 0, n = 0
  for (let i = 0; i < px.length; i += 16) {
    n++
    if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 30) on++
  }
  return on / n
}

/**
 * Runs `code` in the frame. o: theme ('light' | 'dark'), steps ([i…] to photograph), out (folder),
 * name, width, wait (ms after each step), tracer and python. Returns { errors, problems, blank,
 * ready, captions, files }.
 */
async function shoot(win, H, code, o) {
  const t = THEMES[o.theme || 'light']
  const width = o.width || 700
  const host = 'v' + Math.random().toString(36).slice(2, 12).padEnd(8, 'x')
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PARENT(t.tokens.bg, width)))
  await win.webContents.executeJavaScript(`document.getElementById('f').src = ${JSON.stringify(H.frameUrl(host, traced(H, code, o), t))}`)
  let ready = null
  for (let i = 0; i < 100 && !ready; i++) { await wait(100); ready = await win.webContents.executeJavaScript('window.ready') }
  const out = { errors: [], problems: [], blank: false, ready, captions: [], files: [] }
  if (!ready) out.errors.push('It did not finish loading within 10 s.')
  else if (!ready.drawn) out.errors.push('It drew nothing.')
  const post = (m) => win.webContents.executeJavaScript(`document.getElementById('f').contentWindow.postMessage(${JSON.stringify({ tv: 1, ...m })}, '*')`)
  // Three.js may still be loading: give a scene a moment before the audit draws every step
  await wait(o.settle || 600)
  await post({ t: 'control', action: 'audit' })
  for (let i = 0; i < 50; i++) { await wait(100); const a = await win.webContents.executeJavaScript('window.audit'); if (a) { out.problems = a; break } }
  const frame = () => win.webContents.mainFrame.frames[0]
  for (const step of o.steps || [0]) {
    await post({ t: 'control', action: 'goto', i: step })
    await wait(o.wait || 1200)
    const say = await win.webContents.executeJavaScript('window.step && window.step.say')
    out.captions.push(say || '')
    const rect = await win.webContents.executeJavaScript(`(() => { const r = document.getElementById('f').getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) } })()`)
    const img = await win.webContents.capturePage(rect)
    // A canvas that is still blank after its step was drawn
    const canvas = await frame().executeJavaScript(`(() => { const c = document.querySelector('canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } })()`).catch(() => null)
    if (canvas && canvas.width > 20 && canvas.height > 20) {
      const k = img.getSize().width / rect.width
      const share = inked(img.crop({ x: Math.round(canvas.x * k), y: Math.round(canvas.y * k), width: Math.round(canvas.width * k), height: Math.round(canvas.height * k) }), t.tokens.bg)
      if (share < 0.02) out.blank = true
    }
    if (o.out) {
      const file = join(o.out, `viz-${o.name}${(o.steps || [0]).length > 1 ? `-s${step}` : ''}-${o.theme || 'light'}.png`)
      writeFileSync(file, img.toPNG())
      out.files.push(file)
    }
  }
  out.errors.push(...(await win.webContents.executeJavaScript('window.log')))
  if (out.blank) out.errors.push('Its 3D canvas stayed blank: nothing was rendered, or the camera looks away from the scene.')
  return out
}

module.exports = { THEMES, serve, shoot, traced }
