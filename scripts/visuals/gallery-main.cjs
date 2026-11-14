/**
 * The visual gallery's Electron side: each visual runs in the real frame (frameShot.cjs), light
 * and dark, at the step asked for; audited as Tide audits it and photographed. Run through
 * gallery.mjs.
 */
const { app, BrowserWindow, protocol } = require('electron')
const { writeFileSync } = require('fs')
const { serve, shoot } = require('./frameShot.cjs')

const args = JSON.parse(process.env.TIDE_GALLERY || '{}')
const H = require(args.bundle)

protocol.registerSchemesAsPrivileged([{ scheme: H.VISUAL_SCHEME, privileges: { standard: true, secure: true } }])

app.whenReady().then(async () => {
  serve(H)
  const win = new BrowserWindow({ show: false, width: (args.width || 700) + 20, height: 1500, webPreferences: { contextIsolation: true } })
  const results = []
  for (const shot of args.shots) for (const theme of args.themes || ['light', 'dark']) {
    try {
      const r = await shoot(win, H, shot.code, { theme, steps: [shot.step ?? 0], out: args.out, name: shot.name, width: args.width, wait: shot.wait || 900, tracer: args.tracer })
      results.push({ name: shot.name, theme, ...r })
      const bad = r.errors.length || r.problems.length
      console.log(`${bad ? '!' : '✓'} ${shot.name} (${theme})${r.errors.length ? ' errors: ' + r.errors.join(' | ') : ''}${r.problems.length ? ' problems: ' + r.problems.join(' | ') : ''}\n    ${(r.captions[0] || '').slice(0, 180)}`)
    } catch (e) {
      console.log(`✗ ${shot.name} (${theme}): ${e.message}`)
      results.push({ name: shot.name, theme, errors: [e.message] })
    }
  }
  if (args.report) writeFileSync(args.report, JSON.stringify(results, null, 1))
  app.exit(0)
})
