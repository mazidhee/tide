/**
 * The scene pre-generator's Electron side (run through scenes.mjs): for each module part, the
 * visual model writes its big picture, the real frame checks it in light and dark, one repair if
 * it fails, and what passes is kept in the vault as the app keeps it (shared/sceneCache).
 */
const { app, BrowserWindow, protocol } = require('electron')
const { spawn } = require('child_process')
const { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('fs')
const { dirname, join } = require('path')
const os = require('os')
const { serve, shoot } = require('./frameShot.cjs')

const args = JSON.parse(process.env.TIDE_SCENES || '{}')
const H = require(args.bundle)
protocol.registerSchemesAsPrivileged([{ scheme: H.VISUAL_SCHEME, privileges: { standard: true, secure: true } }])

const model = args.model || H.CLAUDE_DEFAULTS.visual
const cwd = mkdtempSync(join(os.tmpdir(), 'tide-scenes-claude-'))

/** One `claude -p` call, as the app makes it (main/claudeEngine onceArgs): no tools, no settings, the system prompt given */
function ask(prompt, system) {
  const argv = ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--permission-mode', 'dontAsk', '--effort', 'medium', '--system-prompt', system]
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const child = spawn(args.claude || 'claude', argv, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), 20 * 60_000)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
    child.on('error', reject)
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const r = JSON.parse(out)
        if (r.is_error) return reject(new Error(r.result || 'Claude stopped'))
        resolve({ text: r.result || '', ms: Date.now() - t0, cost: r.total_cost_usd })
      } catch {
        reject(new Error((err || out).trim().slice(0, 400) || 'no answer'))
      }
    })
    child.stdin.end(prompt)
  })
}

const today = () => new Date().toISOString().slice(0, 10)

async function check(win, code, name) {
  const all = { errors: [], problems: [], steps: 0, files: [] }
  for (const theme of ['light', 'dark']) {
    // Steps to photograph: the whole picture, the middle, the end
    const probe = await shoot(win, H, code, { theme, steps: [0], tracer: args.tracer, wait: 1800, settle: 1500 })
    const n = probe.ready ? probe.ready.steps || 1 : 1
    all.steps = n
    const steps = args.shots ? [...new Set([0, Math.floor((n - 1) / 2), n - 1])] : [0]
    const r = args.shots ? await shoot(win, H, code, { theme, steps, tracer: args.tracer, wait: 2000, settle: 1500, out: args.shots, name }) : probe
    for (const e of [...probe.errors, ...r.errors]) if (!all.errors.includes(e)) all.errors.push(e)
    for (const p of [...probe.problems, ...r.problems]) if (!all.problems.includes(p)) all.problems.push(p)
    all.files.push(...r.files)
    all.captions = r.captions
  }
  return all
}

app.whenReady().then(async () => {
  serve(H)
  const win = new BrowserWindow({ show: false, width: 740, height: 1400, webPreferences: { contextIsolation: true } })
  if (args.shots) mkdirSync(args.shots, { recursive: true })
  const summary = []
  // Free briefs: one scene each, checked and photographed like a part's, kept beside the shots
  for (const b of args.briefs || []) {
    console.log(`→ ${b.name}: asking ${model}…`)
    try {
      const r = await ask(`Brief: ${b.brief}\n\nBuild this as one 3D scene. It must come out within ${Math.round(H.MAX_SCENE / 1000)}k characters.`, H.PART_SCENE_SYSTEM)
      let code = H.extractVisual(r.text)
      if (!code || !H.looksComplete(code)) throw new Error('no complete visual in the reply')
      console.log(`  written in ${Math.round(r.ms / 1000)} s, ${code.length} characters${r.cost ? `, $${r.cost.toFixed(2)}` : ''}`)
      let c = await check(win, code, `art-${b.name}`)
      if (c.errors.length || c.problems.length) {
        const found = [...c.errors, ...c.problems]
        console.log(`  check failed: ${found.join(' | ')}\n  repairing…`)
        const fix = await ask(H.repairPrompt(code, found), `${H.VISUAL_REPAIR_SYSTEM}\n${H.SCENE_REPAIR_NOTE}`)
        const fixed = H.extractVisual(fix.text)
        if (fixed && H.looksComplete(fixed)) { code = fixed; c = await check(win, code, `art-${b.name}`) }
      }
      if (args.shots) writeFileSync(join(args.shots, `art-${b.name}.html`), code)
      const ok = !c.errors.length && !c.problems.length
      console.log(`  ${ok ? '✓' : '✗'} ${H.visualTitle(code)} (${c.steps} steps)${ok ? '' : ': ' + [...c.errors, ...c.problems].join(' | ')}`)
      for (const cap of c.captions || []) console.log(`    “${cap.slice(0, 200)}”`)
      summary.push({ key: b.name, ok })
    } catch (e) {
      console.log(`  ✗ ${e.message}`)
      summary.push({ key: b.name, ok: false })
    }
  }
  for (const id of args.briefs && args.briefs.length ? [] : args.modules) {
    const path = join(args.vault, 'Roadmaps/Modules', `${id}.md`)
    if (!existsSync(path)) { console.log(`✗ ${id}: no module file`); continue }
    const m = H.parseModule(`Roadmaps/Modules/${id}.md`, readFileSync(path, 'utf8'))
    for (let part = 1; ; part++) {
      const brief = H.partBrief(m, part)
      if (!brief) break
      if (args.parts && !args.parts.includes(part)) continue
      const key = H.partKey(m.id, part)
      const file = join(args.vault, H.partFile(key))
      const had = existsSync(file) ? H.readKept(readFileSync(file, 'utf8')) : null
      if (H.usable(had) && !args.force) { console.log(`· ${key} ${brief.title}: kept (${had.meta.model}, ${had.meta.at})`); continue }
      console.log(`→ ${key} ${brief.title}: asking ${model}…`)
      if (args.dry) continue
      const name = `part-${m.id}-${part}`
      try {
        const r = await ask(H.partScenePrompt({ module: brief.moduleTitle, part: brief.title, depthGoal: brief.depthGoal, topics: brief.topics, others: brief.others }), H.PART_SCENE_SYSTEM)
        let code = H.extractVisual(r.text)
        if (!code || !H.looksComplete(code)) throw new Error('no complete visual in the reply')
        console.log(`  written in ${Math.round(r.ms / 1000)} s, ${code.length} characters${r.cost ? `, $${r.cost.toFixed(2)}` : ''}`)
        let c = await check(win, code, name)
        let repaired = false
        if (c.errors.length || c.problems.length) {
          const found = [...c.errors, ...c.problems]
          console.log(`  check failed: ${found.join(' | ')}\n  repairing…`)
          const fix = await ask(H.repairPrompt(code, found), `${H.VISUAL_REPAIR_SYSTEM}\n${H.SCENE_REPAIR_NOTE}`)
          const fixed = H.extractVisual(fix.text)
          if (fixed && H.looksComplete(fixed)) {
            code = fixed
            repaired = true
            c = await check(win, code, name)
          }
        }
        if (c.errors.length || c.problems.length) {
          console.log(`  ✗ not kept (the app shows Tide’s own visual for it instead): ${[...c.errors, ...c.problems].join(' | ')}`)
          summary.push({ key, ok: false })
          continue
        }
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, H.keptText({ code, meta: { model, at: today(), checked: true, ...(repaired ? { repaired: true } : {}), title: H.visualTitle(code) || brief.title } }))
        console.log(`  ✓ kept: ${H.visualTitle(code)} (${c.steps} steps${repaired ? ', repaired' : ''})${c.files.length ? `\n    ${c.files.join('\n    ')}` : ''}`)
        for (const cap of c.captions || []) console.log(`    “${cap.slice(0, 200)}”`)
        summary.push({ key, ok: true })
      } catch (e) {
        console.log(`  ✗ ${e.message}`)
        summary.push({ key, ok: false })
      }
    }
  }
  console.log(`\n${summary.filter((s) => s.ok).length} of ${summary.length} written and kept.`)
  app.exit(0)
})
