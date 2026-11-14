/**
 * A real Electron run of Claude's visual frames (test/visualSandbox.test.ts): the app's own
 * scheme handler, navigation guard, permission handler and limits from main/visualFrames, a page
 * under the packaged app's CSP, and visuals that try to get out. Local servers count every
 * request, connection and packet that reaches them. Prints one RESULT line of JSON, then quits.
 */
import { app, BrowserWindow, ipcMain, protocol, session } from 'electron'
import { createServer } from 'http'
import { createServer as createTcp } from 'net'
import { createSocket } from 'dgram'
import { join } from 'path'
import { readFileSync } from 'fs'
import { VISUAL_SCHEME_PRIVILEGES, serveVisualLibraries, LIMITS, blockVisualRequests, unwatchVisual, denyVisualPermissions, guardVisualFrames, handleVisualProtocol, killVisual, onVisualKilled, visualPid, watchVisual } from '../../../src/main/visualFrames'

protocol.registerSchemesAsPrivileged([VISUAL_SCHEME_PRIVILEGES])
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

const hits: string[] = []
let tcpConnections = 0
let udpPackets = 0
let turnConnections = 0

const out: Record<string, unknown> = {}

app.whenReady().then(async () => {
  const http = createServer((req, res) => {
    hits.push(req.url ?? '')
    res.end('ok')
  })
  http.on('connection', () => tcpConnections++)
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()))
  const port = (http.address() as { port: number }).port
  const udp = createSocket('udp4')
  udp.on('message', () => udpPackets++)
  await new Promise<void>((r) => udp.bind(0, '127.0.0.1', () => r()))
  const turn = createTcp((s) => (turnConnections++, s.destroy()))
  await new Promise<void>((r) => turn.listen(0, '127.0.0.1', () => r()))

  handleVisualProtocol()
  // The frame's maths library, as the app serves it (main/visualLibs), read from the source here
  const tideMath = readFileSync(process.env.TIDE_MATH_JS ?? '', 'utf8')
  // And the computing kit, its modules in the order main/visualLibs joins them
  const machineDir = process.env.TIDE_MACHINE_DIR ?? ''
  const tideMachine = ['core', 'bits', 'circuit', 'memory', 'cpu', 'python', 'studio', 'scene3d', 'teardown', 'spaces', 'end'].map((f) => readFileSync(`${machineDir}/${f}.js`, 'utf8')).join('\n')
  const libs: Record<string, string> = { '/lib/tide-math.js': tideMath, '/lib/tide-machine.js': tideMachine }
  serveVisualLibraries((url, method) => {
    const body = method === 'GET' ? libs[new URL(url).pathname] : undefined
    return body === undefined ? null : { body, headers: { 'content-type': 'text/javascript; charset=utf-8', 'cross-origin-resource-policy': 'cross-origin', 'access-control-allow-origin': '*' } }
  })
  denyVisualPermissions(session.defaultSession)
  if (!process.env.HARNESS_NO_BLOCK) blockVisualRequests(session.defaultSession)
  LIMITS.memoryMb = Number(process.env.HARNESS_MEMORY_MB ?? 250)
  LIMITS.pollMs = 300
  LIMITS.cpuPolls = 6
  const killed: { host: string; reason: string }[] = []
  onVisualKilled((host, reason) => killed.push({ host, reason }))

  const win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false, nodeIntegration: false } })
  guardVisualFrames(win.webContents)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const topNavigations: string[] = []
  win.webContents.on('will-navigate', (e, url) => {
    topNavigations.push(url)
    e.preventDefault()
  })

  ipcMain.handle('harness:ports', () => ({ http: port, udp: (udp.address() as { port: number }).port, turn: (turn.address() as { port: number }).port }))
  ipcMain.handle('harness:watch', (_e, host: string) => watchVisual(win.webContents, host))
  ipcMain.handle('harness:unwatch', (_e, host: string) => unwatchVisual(host, win.webContents))
  ipcMain.handle('harness:pid', (_e, host: string) => visualPid(win.webContents, host))
  ipcMain.handle('harness:kill', (_e, host: string) => killVisual(win.webContents, host, 'test'))
  ipcMain.handle('harness:alive', (_e, pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('harness:frames', () => win.webContents.mainFrame.framesInSubtree.map((f) => { try { return f.url.slice(0, 40) } catch { return 'gone' } }))
  ipcMain.handle('harness:killed', () => killed)
  ipcMain.handle('harness:done', (_e, results: Record<string, unknown>) => {
    Object.assign(out, results, { hits, tcpConnections, udpPackets, turnConnections, topNavigations, windowUrl: win.webContents.getURL(), frameUrls: win.webContents.mainFrame.framesInSubtree.map((f) => f.url.slice(0, 40)), rendererPid: win.webContents.getOSProcessId() })
    process.stdout.write(`RESULT ${JSON.stringify(out)}\n`)
    setTimeout(() => app.exit(0), 50)
  })
  await win.loadFile(join(__dirname, process.env.HARNESS_PAGE ?? 'parent.html'))
  setTimeout(() => {
    process.stdout.write(`RESULT ${JSON.stringify({ timeout: true, hits })}\n`)
    app.exit(1)
  }, 100_000)
})
