/**
 * The visual gallery's Electron side: each visual runs in the real frame (Tide's tide-visual:
 * scheme, CSP, bootstrap and libraries, from the bundle gallery.mjs built), hidden, in a light and
 * a dark theme, at the steps asked for; it is audited as Tide audits it (errors, overlapping
 * labels) and photographed. Run through gallery.mjs.
 */
const { app, BrowserWindow, protocol } = require('electron')
const { execFileSync } = require('child_process')
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('fs')
const { join } = require('path')
const os = require('os')

const args = JSON.parse(process.env.TIDE_GALLERY || '{}')
const H = require(args.bundle)

protocol.registerSchemesAsPrivileged([{ scheme: H.VISUAL_SCHEME, privileges: { standard: true, secure: true } }])

/** Tide's light and dark themes as the frame receives them (renderer lib/visuals readTheme) */
const THEMES = {
  light: { scheme: 'light', tokens: { bg: '#ffffff', surface: '#f5f7fa', ink: '#121a26', 'ink-soft': '#414b5a', muted: '#5f6a7b', line: '#e1e6ed', 'line-strong': '#c9d1dc', accent: '#1257b8', 'accent-soft': 'rgb(231, 238, 248)', pos: '#1257b8', neg: '#eb6834', good: '#1baf7a', bad: '#b3261e', warn: '#8a5600', c1: '#1257b8', c2: '#eb6834', c3: '#1baf7a', c4: '#eda100', c5: '#e87ba4', c6: '#6250d6' } },
  dark: { scheme: 'dark', tokens: { bg: '#1a212c', surface: '#141a23', ink: '#e7eaf0', 'ink-soft': '#b3bbc9', muted: '#8993a5', line: '#242c39', 'line-strong': '#364152', accent: '#7db5f5', 'accent-soft': 'rgb(35, 48, 64)', pos: '#7db5f5', neg: '#d95926', good: '#199e70', bad: '#f08a80', warn: '#e8b04a', c1: '#7db5f5', c2: '#d95926', c3: '#199e70', c4: '#c98500', c5: '#d55181', c6: '#9085e9' } }
}

function traced(code) {
  const src = H.traceSourceOf(code)
  if (!src) return code
  const dir = mkdtempSync(join(os.tmpdir(), 'tide-gallery-'))
  try {
    writeFileSync(join(dir, 'snippet.py'), src)
    execFileSync(args.python || 'python3', ['-I', args.tracer, join(dir, 'snippet.py'), join(dir, 'trace.json')], { timeout: 8000 })
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

async function shoot(win, shot, theme) {
  const t = THEMES[theme]
  const host = 'v' + Math.random().toString(36).slice(2, 12).padEnd(8, 'x')
  const code = traced(shot.code)
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PARENT(t.tokens.bg, args.width || 700)))
  const url = H.frameUrl(host, code, t)
  await win.webContents.executeJavaScript(`document.getElementById('f').src = ${JSON.stringify(url)}`)
  let ready = null
  for (let i = 0; i < 80 && !ready; i++) { await wait(100); ready = await win.webContents.executeJavaScript('window.ready') }
  const out = { name: shot.name, theme, errors: [], problems: [] }
  if (!ready) out.errors.push('never ready')
  // Tide's own check: every step drawn once, overlaps and errors reported
  await win.webContents.executeJavaScript(`document.getElementById('f').contentWindow.postMessage({ tv: 1, t: 'control', action: 'audit' }, '*')`)
  for (let i = 0; i < 40; i++) { await wait(100); const a = await win.webContents.executeJavaScript('window.audit'); if (a) { out.problems = a; break } }
  if (shot.step != null) await win.webContents.executeJavaScript(`document.getElementById('f').contentWindow.postMessage({ tv: 1, t: 'control', action: 'goto', i: ${shot.step} }, '*')`)
  await wait(shot.wait || 900)
  out.errors.push(...(await win.webContents.executeJavaScript('window.log')))
  out.caption = (await win.webContents.executeJavaScript('window.step && window.step.say')) || ''
  const rect = await win.webContents.executeJavaScript(`(() => { const r = document.getElementById('f').getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) } })()`)
  const img = await win.webContents.capturePage(rect)
  const file = join(args.out, `viz-${shot.name}-${theme}.png`)
  writeFileSync(file, img.toPNG())
  out.file = file
  return out
}

app.whenReady().then(async () => {
  protocol.handle(H.VISUAL_SCHEME, (req) => {
    const u = new URL(req.url)
    if (u.pathname.startsWith('/lib/')) {
      const lib = H.libraryResponse(u.pathname)
      return lib ? new Response(lib.body, { headers: lib.headers }) : new Response('no', { status: 404 })
    }
    const r = H.frameResponse(req.url)
    return r ? new Response(r.body, { headers: r.headers }) : new Response('no', { status: 404 })
  })
  const win = new BrowserWindow({ show: false, width: (args.width || 700) + 20, height: 1500, webPreferences: { contextIsolation: true } })
  const results = []
  for (const shot of args.shots) for (const theme of args.themes || ['light', 'dark']) {
    try {
      const r = await shoot(win, shot, theme)
      results.push(r)
      console.log(`${r.errors.length || r.problems.length ? '!' : '✓'} ${shot.name} (${theme})${r.errors.length ? ' errors: ' + r.errors.join(' | ') : ''}${r.problems.length ? ' problems: ' + r.problems.join(' | ') : ''}\n    ${r.caption.slice(0, 160)}`)
    } catch (e) {
      console.log(`✗ ${shot.name} (${theme}): ${e.message}`)
      results.push({ name: shot.name, theme, errors: [e.message] })
    }
  }
  if (args.report) writeFileSync(args.report, JSON.stringify(results, null, 1))
  app.exit(0)
})
